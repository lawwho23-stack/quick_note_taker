import CoreGraphics
import Foundation
import MacShared

/// Watches global key events, detects the Space+N chord, keeps normal typing
/// working by buffering and replaying the Space key, and fires the internal
/// bridge shortcut when a chord is recognised.
///
/// All state transitions are logged to the M0 event log for measurement.
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

    private(set) var isRunning = false
    var isPaused = false
    var mode: Mode = .plain {
        didSet { log.log("mode_changed", ["mode": mode.rawValue]) }
    }

    // Key state
    private var spaceDownPhys = false      // physical space key currently held
    private var spaceBuffered = false      // space keyDown swallowed, not yet replayed
    private var bufferedSpaceEvent: CGEvent?
    private var spaceDownAt: Double = 0
    private var awaitingSpaceUp = false    // chord fired; swallow space until its keyUp
    private var awaitingNUp = false        // chord fired; swallow n until its keyUp

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
        log.log("tap_started")
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

    /// Replays a buffered space (if any) so pausing or quitting never leaves
    /// a space key logically stuck.
    func drainBuffer() {
        replayBufferedSpace()
    }

    // MARK: - Event handling

    private func handle(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            log.log("tap_disabled", ["kind": type == .tapDisabledByTimeout ? "timeout" : "user_input"])
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
        let keycode = event.getIntegerValueField(.keyboardEventKeycode)
        switch type {
        case .keyDown:
            return keyDown(keycode: keycode, event: event)
        case .keyUp:
            return keyUp(keycode: keycode, event: event)
        default:
            return Unmanaged.passUnretained(event)
        }
    }

    private func keyDown(keycode: Int64, event: CGEvent) -> Unmanaged<CGEvent>? {
        let now = Date().timeIntervalSince1970

        if keycode == KeyCodes.space {
            if awaitingSpaceUp {
                log.log("space_repeat_after_chord")
                return nil
            }
            if spaceDownPhys {
                if spaceBuffered {
                    log.log("space_repeat_buffered")
                    return nil
                }
                log.log("space_repeat_pass")
                return Unmanaged.passUnretained(event)
            }
            spaceDownPhys = true
            let modifiers = event.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift])
            if !modifiers.isEmpty {
                // e.g. Command+Space (Spotlight) — never capture a modified space.
                log.log("space_mod_passthrough", ["flags": Int(modifiers.rawValue)])
                return Unmanaged.passUnretained(event)
            }
            spaceBuffered = true
            spaceDownAt = now
            bufferedSpaceEvent = event.copy()
            log.log("space_down_buffered")
            return nil
        }

        if keycode == KeyCodes.n {
            if awaitingNUp {
                log.log("n_repeat_after_chord")
                return nil
            }
            if spaceBuffered {
                let heldMs = (now - spaceDownAt) * 1000
                let modifiers = event.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift])
                if modifiers.isEmpty && heldMs >= mode.thresholdMs {
                    fireChord(heldMs: heldMs)
                    return nil
                }
                log.log("n_pass", ["held_ms": heldMs.rounded(), "modifiers": Int(modifiers.rawValue)])
                replayBufferedSpace()
                return Unmanaged.passUnretained(event)
            }
            log.log("n_pass_no_buffer")
            return Unmanaged.passUnretained(event)
        }

        if spaceBuffered {
            let heldMs = (now - spaceDownAt) * 1000
            log.log("other_key_replay", ["keycode": keycode, "held_ms": heldMs.rounded()])
            replayBufferedSpace()
        }
        return Unmanaged.passUnretained(event)
    }

    private func keyUp(keycode: Int64, event: CGEvent) -> Unmanaged<CGEvent>? {
        if keycode == KeyCodes.space {
            if awaitingSpaceUp {
                awaitingSpaceUp = false
                spaceDownPhys = false
                log.log("space_up_after_chord")
                return nil
            }
            if spaceBuffered {
                // Plain space press (no chord): replay both down and up.
                spaceBuffered = false
                spaceDownPhys = false
                if let copy = bufferedSpaceEvent {
                    Synthetic.mark(copy)
                    copy.post(tap: .cghidEventTap)
                    log.log("space_replayed_down_up")
                }
                bufferedSpaceEvent = nil
                return Unmanaged.passUnretained(event)
            }
            spaceDownPhys = false
            log.log("space_up_pass")
            return Unmanaged.passUnretained(event)
        }

        if keycode == KeyCodes.n {
            if awaitingNUp {
                awaitingNUp = false
                log.log("n_up_after_chord")
                return nil
            }
            log.log("n_up_pass")
            return Unmanaged.passUnretained(event)
        }

        return Unmanaged.passUnretained(event)
    }

    private func fireChord(heldMs: Double) {
        spaceBuffered = false
        bufferedSpaceEvent = nil
        awaitingSpaceUp = true
        awaitingNUp = true
        log.log("chord", ["held_ms": heldMs.rounded(), "mode": mode.rawValue])
        BridgeShortcut.post()
    }

    private func replayBufferedSpace() {
        guard spaceBuffered, let copy = bufferedSpaceEvent else { return }
        spaceBuffered = false
        bufferedSpaceEvent = nil
        Synthetic.mark(copy)
        copy.post(tap: .cghidEventTap)
        log.log("space_replayed_down")
    }
}
