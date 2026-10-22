/// Pure description of how the bridge shortcut (Control+Shift+7) is delivered.
/// MacShared turns these values into real CGEvents.

/// Which CGEventSource state the synthetic events are created from.
public enum EventSourceKind: String, Equatable {
    /// `.privateState`: our own modifier state, ignores the physical keyboard.
    case privateState
    /// `.hidSystemState`: shares the hardware keyboard state.
    case hidSystemState
}

/// Where the synthetic events are inserted into the event stream.
public enum PostLocation: String, Equatable {
    /// `.cghidEventTap`: as if typed on the hardware keyboard.
    case hid
    /// `.cgSessionEventTap`: after the HID layer, at the login session level.
    case session
}

/// Delivery variants selectable from the menu bar, to measure which one
/// Chrome receives reliably.
public enum DeliveryVariant: String, CaseIterable, Equatable {
    case asyncHIDPrivate = "a"
    case hidSystemSource = "b"
    case sessionTap = "c"
    case fireOnNKeyUp = "d"

    public static let `default`: DeliveryVariant = .asyncHIDPrivate

    public var title: String {
        switch self {
        case .asyncHIDPrivate: return "(a) Async post, HID tap, private source [default]"
        case .hidSystemSource: return "(b) Async post, HID tap, HID-system source"
        case .sessionTap: return "(c) Async post, session tap, private source"
        case .fireOnNKeyUp: return "(d) Fire on N key-up (HID tap, private source)"
        }
    }

    public var source: EventSourceKind {
        self == .hidSystemSource ? .hidSystemState : .privateState
    }

    public var location: PostLocation {
        self == .sessionTap ? .session : .hid
    }

    public var fireOn: FireTrigger {
        self == .fireOnNKeyUp ? .nKeyUp : .nKeyDown
    }
}

/// Timing and retry settings for one delivery.
public struct DeliverySettings: Equatable {
    public var variant: DeliveryVariant
    /// Wait after the tap callback returns before posting the first event.
    public var scheduleDelayMs: Double
    /// Gap between consecutive synthetic events (M0 used 5 ms).
    public var gapMs: Double
    /// Post the whole shortcut a second time after `retryDelayMs`.
    public var retryEnabled: Bool
    public var retryDelayMs: Double

    public init(
        variant: DeliveryVariant = .default,
        scheduleDelayMs: Double = 20,
        gapMs: Double = 10,
        retryEnabled: Bool = false,
        retryDelayMs: Double = 300
    ) {
        self.variant = variant
        self.scheduleDelayMs = scheduleDelayMs
        self.gapMs = gapMs
        self.retryEnabled = retryEnabled
        self.retryDelayMs = retryDelayMs
    }

    /// Clamp user-provided values (from UserDefaults) into a safe range.
    public func clamped() -> DeliverySettings {
        var s = self
        s.scheduleDelayMs = min(max(s.scheduleDelayMs, 0), 500)
        s.gapMs = min(max(s.gapMs, 0), 50)
        s.retryDelayMs = min(max(s.retryDelayMs, 50), 2000)
        return s
    }
}

public enum BridgeKey: String, Equatable, CaseIterable {
    case control
    case shift
    case seven
}

public enum BridgeModifier: String, Hashable {
    case control
    case shift
}

/// One synthetic key event in the bridge shortcut sequence.
public struct PlanStep: Equatable {
    public var key: BridgeKey
    public var isDown: Bool
    /// Modifier flags carried by the event.
    public var flags: Set<BridgeModifier>
    /// Delay from the previous step (0 for the first step).
    public var delayMs: Double

    public init(key: BridgeKey, isDown: Bool, flags: Set<BridgeModifier>, delayMs: Double) {
        self.key = key
        self.isDown = isDown
        self.flags = flags
        self.delayMs = delayMs
    }
}

public enum DeliveryPlan {
    /// Control down, Shift down, 7 down, 7 up, Shift up, Control up.
    public static func bridgeShortcut(gapMs: Double) -> [PlanStep] {
        let both: Set<BridgeModifier> = [.control, .shift]
        let steps: [(BridgeKey, Bool, Set<BridgeModifier>)] = [
            (.control, true, [.control]),
            (.shift, true, both),
            (.seven, true, both),
            (.seven, false, both),
            (.shift, false, [.control]),
            (.control, false, []),
        ]
        return steps.enumerated().map { index, step in
            PlanStep(key: step.0, isDown: step.1, flags: step.2, delayMs: index == 0 ? 0 : gapMs)
        }
    }

    /// Key-up steps needed to release everything pressed by the first
    /// `postedCount` steps of `plan` (used to clean up after an aborted
    /// sequence, so no modifier stays stuck).
    public static func releaseSteps(for plan: [PlanStep], postedCount: Int) -> [PlanStep] {
        var held: [BridgeKey] = []
        for step in plan.prefix(postedCount) {
            if step.isDown {
                if !held.contains(step.key) { held.append(step.key) }
            } else {
                held.removeAll { $0 == step.key }
            }
        }
        var remaining = Set(held.compactMap(modifier(for:)))
        return held.reversed().map { key in
            if let m = modifier(for: key) { remaining.remove(m) }
            return PlanStep(key: key, isDown: false, flags: remaining, delayMs: 0)
        }
    }

    /// Keys still held after running `steps` in order (empty = clean).
    public static func keysHeld(after steps: [PlanStep]) -> Set<BridgeKey> {
        var held = Set<BridgeKey>()
        for step in steps {
            if step.isDown { held.insert(step.key) } else { held.remove(step.key) }
        }
        return held
    }

    static func modifier(for key: BridgeKey) -> BridgeModifier? {
        switch key {
        case .control: return .control
        case .shift: return .shift
        case .seven: return nil
        }
    }
}
