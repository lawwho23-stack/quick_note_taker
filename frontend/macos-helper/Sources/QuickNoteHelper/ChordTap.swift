import ChordCore
import CoreGraphics
import Foundation
import MacShared

/// Watches global key events and feeds them to the pure `ChordStateMachine`
/// (ChordCore). This class only does the CoreGraphics work the machine asks
/// for: pass or swallow the event, replay the buffered Space, and hand a
/// detected chord to `BridgeDelivery`, which posts the shortcut AFTER this
/// callback has returned (never inside it).
///
/// All decisions are logged to the event log for measurement.
final class ChordTap {
    enum Mode: String, CaseIterable {
        case plain = "Plain chord (any overlap)"
        case threshold120 = "Hold ≥ 120 ms"
        case threshold200 = "Hold ≥ 200 ms"

        var thresholdMs: Double {
            switch self {
            case .plain: return 0
            case .threshold120: return 120
            case .threshold200: return 200
            }
        }
    }

    private let log = EventLog.shared
    private var tap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var machine = ChordStateMachine()
    private let delivery = BridgeDelivery()
    /// Copy of the swallowed Space key-down, replayed if no chord follows.
    private var bufferedSpaceEvent: CGEvent?

    private(set) var isRunning = false
    var isPaused = false
    var mode: Mode = .plain {
        didSet {
            machine.config.minHoldMs = mode.thresholdMs
            log.log("mode_changed", ["mode": mode.rawValue])
        }
    }
    var settings = DeliverySettings() {
        didSet {
            if machine.config.fireOn != settings.variant.fireOn {
                // Switching trigger mid-press could fire late; start clean.
                drainBuffer()
                machine.config.fireOn = settings.variant.fireOn
            }
            log.log("delivery_settings_changed", [
                "variant": settings.variant.rawValue, "retry": settings.retryEnabled,
                "schedule_delay_ms": settings.scheduleDelayMs, "gap_ms": settings.gapMs,
            ])
        }
    }

    init(mode: Mode, settings: DeliverySettings) {
        self.mode = mode
        self.settings = settings
        machine.config = ChordStateMachine.Config(minHoldMs: mode.thresholdMs, fireOn: settings.variant.fireOn)
    }

    // MARK: - Tap lifecycle

    @discardableResult
    func start() -> Bool {
        guard !isRunning else { return true }
        let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, userInfo in
                guard let userInfo else { return Unmanaged.passUnretained(event) }
                let chordTap = Unmanaged<ChordTap>.fromOpaque(userInfo).takeUnretainedValue()
                return chordTap.handle(type: type, event: event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            log.log("tap_create_failed")
            return false
        }
        self.tap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        isRunning = true
        log.log("tap_started", ["variant": settings.variant.rawValue])
        return true
    }

    func stop() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let runLoopSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes) }
        tap = nil
        runLoopSource = nil
        isRunning = false
        log.log("tap_stopped")
    }

    /// Forget chord state and replay a buffered Space (if any), so pausing or
    /// quitting never leaves a key logically stuck or a key-up fire armed.
    func drainBuffer() {
        if machine.reset() {
            replayBufferedSpace()
        }
        bufferedSpaceEvent = nil
    }

    /// Before quitting: release any synthetic modifiers still in flight.
    func shutdown() {
        drainBuffer()
        delivery.releaseInFlight()
    }

    // MARK: - Event handling

    private func handle(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        let callbackStart = monotonicMs()
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            log.log("tap_disabled", ["kind": type == .tapDisabledByTimeout ? "timeout" : "user_input"])
            // Key-ups may have been missed while disabled: start clean.
            drainBuffer()
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        // Never process our own synthetic events (recursion guard).
        if Synthetic.isOurs(event) {
            return Unmanaged.passUnretained(event)
        }
        if isPaused {
            return Unmanaged.passUnretained(event)
        }
        guard type == .keyDown || type == .keyUp else {
            return Unmanaged.passUnretained(event)
        }

        let input = Self.makeInput(type: type, event: event, timeMs: callbackStart)
        let decision = machine.handle(input)

        if decision.replaySpaceFirst {
            replayBufferedSpace()
        }
        if input.key == .space && input.isDown && !input.isAutorepeat && machine.spaceBuffered {
            bufferedSpaceEvent = event.copy()
        }
        if decision.fire {
            // Scheduled on the main queue; runs after this callback returns.
            delivery.fire(settings: settings, trigger: decision.label, requestedAtMs: callbackStart)
        }

        var fields: [String: Any] = [
            "callback_ms": (monotonicMs() - callbackStart).rounded(toPlaces: 3),
        ]
        if let held = decision.heldMs { fields["held_ms"] = held.rounded() }
        if decision.fire || decision.label.hasPrefix("chord") {
            fields["mode"] = mode.rawValue
            fields["variant"] = settings.variant.rawValue
        }
        if case .other(let code) = input.key, decision.replaySpaceFirst { fields["keycode"] = code }
        log.log(decision.label, fields)

        return decision.disposition == .pass ? Unmanaged.passUnretained(event) : nil
    }

    static func makeInput(type: CGEventType, event: CGEvent, timeMs: Double) -> ChordStateMachine.Input {
        let keycode = event.getIntegerValueField(.keyboardEventKeycode)
        let key: ChordStateMachine.Key
        switch keycode {
        case KeyCodes.space: key = .space
        case KeyCodes.n: key = .n
        default: key = .other(keycode)
        }
        let modifiers = event.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift])
        return ChordStateMachine.Input(
            key: key,
            isDown: type == .keyDown,
            isAutorepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
            hasModifiers: !modifiers.isEmpty,
            timeMs: timeMs
        )
    }

    private func replayBufferedSpace() {
        guard let copy = bufferedSpaceEvent else { return }
        bufferedSpaceEvent = nil
        Synthetic.mark(copy)
        copy.post(tap: .cghidEventTap)
        log.log("space_replayed_down")
    }
}
