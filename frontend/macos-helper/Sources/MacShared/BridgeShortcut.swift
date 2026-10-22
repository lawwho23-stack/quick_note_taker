import ChordCore
import CoreGraphics
import Foundation

/// Posts the internal bridge shortcut (Control+Shift+7 on macOS) as synthetic
/// keyboard events.
///
/// The extension registers `MacCtrl+Shift+7` (Control+Shift+7 on macOS) as its
/// `open-capture` command. Chrome reserves global shortcuts for modifier
/// combinations, which is exactly why a helper is needed to deliver the
/// user-facing Space+N gesture.
public enum BridgeShortcut {
    /// The key combination delivered to the browser, for display purposes.
    public static let displayName = "Control+Shift+7"

    /// Synchronous post with blocking gaps. Only for BridgeProbe (no event
    /// tap there). The helper uses `BridgeDelivery` instead.
    public static func post() {
        guard let source = makeSource(.privateState) else { return }
        for step in DeliveryPlan.bridgeShortcut(gapMs: 5) {
            if step.delayMs > 0 { usleep(UInt32(step.delayMs * 1000)) }
            if let event = makeEvent(step, source: source) {
                post(event, at: .hid)
            }
        }
    }

    public static func makeSource(_ kind: EventSourceKind) -> CGEventSource? {
        switch kind {
        case .privateState: return CGEventSource(stateID: .privateState)
        case .hidSystemState: return CGEventSource(stateID: .hidSystemState)
        }
    }

    public static func makeEvent(_ step: PlanStep, source: CGEventSource) -> CGEvent? {
        let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode(step.key), keyDown: step.isDown)
        var flags: CGEventFlags = []
        if step.flags.contains(.control) { flags.insert(.maskControl) }
        if step.flags.contains(.shift) { flags.insert(.maskShift) }
        event?.flags = flags
        if let event { Synthetic.mark(event) }
        return event
    }

    public static func post(_ event: CGEvent, at location: PostLocation) {
        switch location {
        case .hid: event.post(tap: .cghidEventTap)
        case .session: event.post(tap: .cgSessionEventTap)
        }
    }

    static func keyCode(_ key: BridgeKey) -> CGKeyCode {
        switch key {
        case .control: return KeyCodes.control
        case .shift: return KeyCodes.shift
        case .seven: return KeyCodes.seven
        }
    }
}

/// Monotonic milliseconds since boot (not affected by clock changes).
public func monotonicMs() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
}

/// Delivers the bridge shortcut asynchronously on the main queue, OUTSIDE the
/// event tap callback. Each synthetic event is posted in its own main-queue
/// turn, so the run loop that services the tap is never blocked by sleeps.
///
/// Main thread only (same as EventLog).
public final class BridgeDelivery {
    private let log = EventLog.shared
    private var inFlight: InFlight?
    private var nextFireID = 0

    private struct InFlight {
        let id: Int
        let attempt: Int
        let plan: [PlanStep]
        let source: CGEventSource
        let location: PostLocation
        var posted: Int
    }

    public init() {}

    public var isBusy: Bool { inFlight != nil }

    /// Schedule one delivery (plus optional retry). `requestedAtMs` is the
    /// monotonic time the tap decided to fire, used to log the real delay.
    public func fire(settings raw: DeliverySettings, trigger: String, requestedAtMs: Double) {
        let settings = raw.clamped()
        nextFireID += 1
        let id = nextFireID
        schedule(id: id, attempt: 1, settings: settings, trigger: trigger, requestedAtMs: requestedAtMs, delayMs: settings.scheduleDelayMs)
    }

    private func schedule(id: Int, attempt: Int, settings: DeliverySettings, trigger: String, requestedAtMs: Double, delayMs: Double) {
        log.log("post_scheduled", [
            "fire_id": id, "attempt": attempt, "variant": settings.variant.rawValue,
            "trigger": trigger, "delay_ms": delayMs,
        ])
        DispatchQueue.main.asyncAfter(deadline: .now() + delayMs / 1000) { [weak self] in
            self?.start(id: id, attempt: attempt, settings: settings, trigger: trigger, requestedAtMs: requestedAtMs)
        }
    }

    private func start(id: Int, attempt: Int, settings: DeliverySettings, trigger: String, requestedAtMs: Double) {
        let startMs = monotonicMs()
        if inFlight != nil {
            // Never interleave two sequences (that could leave modifiers stuck).
            log.log("post_skipped_busy", ["fire_id": id, "attempt": attempt, "variant": settings.variant.rawValue])
            return
        }
        guard let source = BridgeShortcut.makeSource(settings.variant.source) else {
            log.log("event_source_failed", [
                "fire_id": id, "attempt": attempt, "variant": settings.variant.rawValue,
                "source": settings.variant.source.rawValue,
            ])
            return
        }
        let plan = DeliveryPlan.bridgeShortcut(gapMs: settings.gapMs)
        inFlight = InFlight(id: id, attempt: attempt, plan: plan, source: source, location: settings.variant.location, posted: 0)
        log.log("post_start", [
            "fire_id": id, "attempt": attempt, "variant": settings.variant.rawValue,
            "trigger": trigger, "source": settings.variant.source.rawValue,
            "location": settings.variant.location.rawValue, "gap_ms": settings.gapMs,
            "schedule_delay_actual_ms": (startMs - requestedAtMs).rounded(toPlaces: 2),
        ])
        postNext(settings: settings, trigger: trigger, requestedAtMs: requestedAtMs, startMs: startMs)
    }

    private func postNext(settings: DeliverySettings, trigger: String, requestedAtMs: Double, startMs: Double) {
        guard var flight = inFlight else { return }
        if flight.posted >= flight.plan.count {
            inFlight = nil
            let endMs = monotonicMs()
            log.log("post_end", [
                "fire_id": flight.id, "attempt": flight.attempt, "variant": settings.variant.rawValue,
                "events": flight.posted, "duration_ms": (endMs - startMs).rounded(toPlaces: 2),
                "since_request_ms": (endMs - requestedAtMs).rounded(toPlaces: 2),
            ])
            if settings.retryEnabled && flight.attempt == 1 {
                schedule(id: flight.id, attempt: 2, settings: settings, trigger: trigger + "_retry",
                         requestedAtMs: monotonicMs(), delayMs: settings.retryDelayMs)
            }
            return
        }
        let step = flight.plan[flight.posted]
        if let event = BridgeShortcut.makeEvent(step, source: flight.source) {
            BridgeShortcut.post(event, at: flight.location)
            log.log("post_event", [
                "fire_id": flight.id, "key": step.key.rawValue, "down": step.isDown,
                "cg_type": Int(event.type.rawValue),
            ])
        } else {
            log.log("event_create_failed", ["fire_id": flight.id, "key": step.key.rawValue, "down": step.isDown])
        }
        flight.posted += 1
        inFlight = flight
        let delay = flight.posted < flight.plan.count ? flight.plan[flight.posted].delayMs : 0
        DispatchQueue.main.asyncAfter(deadline: .now() + delay / 1000) { [weak self] in
            self?.postNext(settings: settings, trigger: trigger, requestedAtMs: requestedAtMs, startMs: startMs)
        }
    }

    /// Synchronously release any keys a sequence in flight has pressed (call
    /// before quitting), so Control/Shift never stay logically held.
    public func releaseInFlight() {
        guard let flight = inFlight else { return }
        inFlight = nil
        let ups = DeliveryPlan.releaseSteps(for: flight.plan, postedCount: flight.posted)
        for step in ups {
            if let event = BridgeShortcut.makeEvent(step, source: flight.source) {
                BridgeShortcut.post(event, at: flight.location)
            }
        }
        log.log("post_aborted_released", ["fire_id": flight.id, "released": ups.count])
    }
}

extension Double {
    public func rounded(toPlaces places: Int) -> Double {
        let factor = pow(10, Double(places))
        return (self * factor).rounded() / factor
    }
}
