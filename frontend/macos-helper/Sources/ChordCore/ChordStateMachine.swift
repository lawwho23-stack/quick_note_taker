/// Pure Space+N chord detector. No CoreGraphics, no clocks, no side effects:
/// feed it key events, it tells the caller what to do with each one.
///
/// The caller (ChordTap) owns the real CGEvents. This type only decides:
/// - pass the event on, or swallow it;
/// - replay the buffered Space key-down first (so normal typing still works);
/// - fire the bridge shortcut.
public struct ChordStateMachine {
    public struct Config: Equatable {
        /// N must arrive at least this long after Space went down (0 = any overlap).
        public var minHoldMs: Double
        /// If set, an N arriving later than this after Space went down is
        /// treated as normal typing (Space replayed, N passed through).
        public var maxHoldMs: Double?
        /// Fire on N key-down (default) or on N key-up (delivery variant d).
        public var fireOn: FireTrigger

        public init(minHoldMs: Double = 0, maxHoldMs: Double? = nil, fireOn: FireTrigger = .nKeyDown) {
            self.minHoldMs = minHoldMs
            self.maxHoldMs = maxHoldMs
            self.fireOn = fireOn
        }
    }

    public enum Key: Equatable {
        case space
        case n
        case other(Int64)
    }

    public struct Input: Equatable {
        public var key: Key
        public var isDown: Bool
        /// Value of the event's autorepeat field (true for held-key repeats).
        public var isAutorepeat: Bool
        /// Command, Control, Option or Shift held.
        public var hasModifiers: Bool
        /// Monotonic event time in milliseconds.
        public var timeMs: Double

        public init(key: Key, isDown: Bool, isAutorepeat: Bool = false, hasModifiers: Bool = false, timeMs: Double) {
            self.key = key
            self.isDown = isDown
            self.isAutorepeat = isAutorepeat
            self.hasModifiers = hasModifiers
            self.timeMs = timeMs
        }
    }

    public enum Disposition: Equatable {
        case pass
        case swallow
    }

    public struct Decision: Equatable {
        public var disposition: Disposition
        /// Post the buffered Space key-down before letting this event through.
        public var replaySpaceFirst: Bool
        /// Fire the bridge shortcut (the caller schedules it after the callback).
        public var fire: Bool
        /// Short log label, e.g. "chord", "space_down_buffered".
        public var label: String
        /// How long Space had been held when this decision was made, if relevant.
        public var heldMs: Double?

        public init(_ disposition: Disposition, replaySpaceFirst: Bool = false, fire: Bool = false, label: String, heldMs: Double? = nil) {
            self.disposition = disposition
            self.replaySpaceFirst = replaySpaceFirst
            self.fire = fire
            self.label = label
            self.heldMs = heldMs
        }
    }

    public var config: Config

    // MARK: State

    /// Physical Space is down (as far as we have seen).
    public private(set) var spaceDown = false
    /// Space key-down was swallowed and has not been replayed yet.
    public private(set) var spaceBuffered = false
    /// Physical N is down.
    public private(set) var nDown = false
    /// A chord was recognised; the Space press belongs to it (swallow its up/repeats).
    public private(set) var spaceConsumed = false
    /// A chord was recognised; this N press belongs to it (swallow its up/repeats).
    public private(set) var nConsumed = false
    /// Fire-on-key-up variant: chord recognised, waiting for N key-up to fire.
    public private(set) var armedForKeyUp = false
    private var spaceDownAtMs: Double = 0

    public init(config: Config = Config()) {
        self.config = config
    }

    /// Forget all state (after a tap timeout, pause, or quit). Returns true
    /// when a buffered Space key-down still needs to be replayed by the caller.
    @discardableResult
    public mutating func reset() -> Bool {
        let needsReplay = spaceBuffered
        spaceDown = false
        spaceBuffered = false
        nDown = false
        spaceConsumed = false
        nConsumed = false
        armedForKeyUp = false
        return needsReplay
    }

    public mutating func handle(_ input: Input) -> Decision {
        switch (input.key, input.isDown) {
        case (.space, true): return spaceKeyDown(input)
        case (.space, false): return spaceKeyUp(input)
        case (.n, true): return nKeyDown(input)
        case (.n, false): return nKeyUp(input)
        case (.other, true): return otherKeyDown(input)
        case (.other, false): return Decision(.pass, label: "other_up_pass")
        }
    }

    // MARK: Space

    private mutating func spaceKeyDown(_ input: Input) -> Decision {
        if input.isAutorepeat && spaceDown {
            if spaceConsumed { return Decision(.swallow, label: "space_repeat_after_chord") }
            if spaceBuffered { return Decision(.swallow, label: "space_repeat_buffered") }
            return Decision(.pass, label: "space_repeat_pass")
        }
        // A fresh (non-repeat) press. If we still think Space is down, a key-up
        // was missed (e.g. tap disabled); start over instead of swallowing it.
        var label = "space_down_buffered"
        if spaceDown || spaceConsumed {
            label = "space_down_buffered_stale_reset"
        }
        let staleBuffered = spaceBuffered
        spaceDown = true
        spaceConsumed = false
        armedForKeyUp = false
        if input.hasModifiers {
            // e.g. Command+Space (Spotlight): never capture a modified Space.
            spaceBuffered = false
            return Decision(.pass, replaySpaceFirst: staleBuffered, label: "space_mod_passthrough")
        }
        spaceBuffered = true
        spaceDownAtMs = input.timeMs
        // A stale buffered Space (its key-up was missed) is replayed first so
        // no typed space is lost; then this new press becomes the buffered one.
        return Decision(.swallow, replaySpaceFirst: staleBuffered, label: label)
    }

    private mutating func spaceKeyUp(_ input: Input) -> Decision {
        let held = spaceDown ? input.timeMs - spaceDownAtMs : nil
        defer { spaceDown = false }
        if spaceConsumed {
            spaceConsumed = false
            return Decision(.swallow, label: "space_up_after_chord", heldMs: held)
        }
        if spaceBuffered {
            // Plain Space tap: replay the down, then let the up through.
            spaceBuffered = false
            return Decision(.pass, replaySpaceFirst: true, label: "space_replayed_down_up", heldMs: held)
        }
        return Decision(.pass, label: "space_up_pass")
    }

    // MARK: N

    private mutating func nKeyDown(_ input: Input) -> Decision {
        if input.isAutorepeat && nDown {
            if nConsumed { return Decision(.swallow, label: "n_repeat_after_chord") }
            return Decision(.pass, label: "n_repeat_pass")
        }
        // Fresh N press (any old N state is stale).
        nDown = true
        nConsumed = false
        armedForKeyUp = false

        guard spaceBuffered || (spaceConsumed && spaceDown) else {
            return Decision(.pass, label: "n_pass_no_buffer")
        }
        let held = input.timeMs - spaceDownAtMs
        if spaceConsumed {
            // Space still held from an earlier chord and N tapped again: a
            // deliberate new press, so fire again (the extension just focuses
            // the existing capture card).
            return chordDetected(held: held, label: "chord_repeat_press")
        }
        let tooEarly = held < config.minHoldMs
        let tooLate = config.maxHoldMs.map { held > $0 } ?? false
        if input.hasModifiers || tooEarly || tooLate {
            spaceBuffered = false
            let why = input.hasModifiers ? "n_pass_modifiers" : (tooEarly ? "n_pass_too_early" : "n_pass_too_late")
            return Decision(.pass, replaySpaceFirst: true, label: why, heldMs: held)
        }
        spaceBuffered = false
        spaceConsumed = true
        return chordDetected(held: held, label: "chord")
    }

    private mutating func chordDetected(held: Double, label: String) -> Decision {
        nConsumed = true
        switch config.fireOn {
        case .nKeyDown:
            return Decision(.swallow, fire: true, label: label, heldMs: held)
        case .nKeyUp:
            armedForKeyUp = true
            return Decision(.swallow, label: label + "_armed", heldMs: held)
        }
    }

    private mutating func nKeyUp(_ input: Input) -> Decision {
        defer { nDown = false }
        if nConsumed {
            nConsumed = false
            if armedForKeyUp {
                armedForKeyUp = false
                return Decision(.swallow, fire: true, label: "n_up_fire")
            }
            return Decision(.swallow, label: "n_up_after_chord")
        }
        return Decision(.pass, label: "n_up_pass")
    }

    // MARK: Other keys

    private mutating func otherKeyDown(_ input: Input) -> Decision {
        if spaceBuffered {
            spaceBuffered = false
            return Decision(.pass, replaySpaceFirst: true, label: "other_key_replay", heldMs: input.timeMs - spaceDownAtMs)
        }
        return Decision(.pass, label: "other_pass")
    }
}

public enum FireTrigger: String, Equatable {
    case nKeyDown
    case nKeyUp
}
