import ChordCore

/// Tiny assertion harness shared by the executable runner
/// (`swift run ChordCoreTestRunner`) and the `swift test` target. It exists
/// because the installed Command Line Tools have no XCTest, and SwiftPM does
/// not execute Swift Testing suites there.
public final class Checker {
    public private(set) var failures: [String] = []

    public init() {}

    public func expect(_ condition: Bool, _ message: @autoclosure () -> String, line: UInt = #line) {
        if !condition { failures.append("line \(line): \(message())") }
    }

    public func equal<T: Equatable>(_ actual: T, _ expected: T, _ what: String = "", line: UInt = #line) {
        if actual != expected {
            failures.append("line \(line): \(what) expected \(expected), got \(actual)")
        }
    }
}

public struct CheckCase {
    public let name: String
    public let run: (Checker) -> Void
}

/// Drives a ChordStateMachine with a fake clock.
struct Sim {
    var machine: ChordStateMachine
    var now: Double = 1_000

    init(_ config: ChordStateMachine.Config = .init()) {
        machine = ChordStateMachine(config: config)
    }

    mutating func wait(_ ms: Double) { now += ms }

    @discardableResult
    mutating func down(_ key: ChordStateMachine.Key, repeat isRepeat: Bool = false, mods: Bool = false) -> ChordStateMachine.Decision {
        machine.handle(.init(key: key, isDown: true, isAutorepeat: isRepeat, hasModifiers: mods, timeMs: now))
    }

    @discardableResult
    mutating func up(_ key: ChordStateMachine.Key) -> ChordStateMachine.Decision {
        machine.handle(.init(key: key, isDown: false, timeMs: now))
    }
}
