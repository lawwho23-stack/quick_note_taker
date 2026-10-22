import ChordCore

/// Records what the rest of macOS would see after the tap: replayed Space
/// downs, passed-through events, and fired shortcuts.
struct Stream {
    var sim: Sim
    var out: [String] = []
    var fires = 0

    init(_ config: ChordStateMachine.Config = .init()) { sim = Sim(config) }

    mutating func wait(_ ms: Double) { sim.wait(ms) }

    mutating func apply(_ d: ChordStateMachine.Decision, _ name: String) {
        if d.replaySpaceFirst { out.append("space↓") }
        if d.disposition == .pass { out.append(name) }
        if d.fire { fires += 1; out.append("FIRE") }
    }

    mutating func down(_ key: ChordStateMachine.Key, repeat r: Bool = false, mods: Bool = false) {
        apply(sim.down(key, repeat: r, mods: mods), Self.name(key) + (r ? "↻" : "↓"))
    }

    mutating func up(_ key: ChordStateMachine.Key) {
        apply(sim.up(key), Self.name(key) + "↑")
    }

    static func name(_ key: ChordStateMachine.Key) -> String {
        switch key {
        case .space: return "space"
        case .n: return "n"
        case .other(let c): return "k\(c)"
        }
    }
}

let keyA: ChordStateMachine.Key = .other(0)
let keyB: ChordStateMachine.Key = .other(11)

public enum ChordCoreChecks {
    public static let all: [CheckCase] = chordCases + deliveryCases

    // MARK: - Chord state machine

    static let chordCases: [CheckCase] = [
        CheckCase(name: "space held then N fires once, both swallowed") { c in
            var s = Stream()
            s.down(.space); s.wait(80); s.down(.n); s.wait(40); s.up(.n); s.wait(30); s.up(.space)
            c.equal(s.fires, 1, "fires")
            c.equal(s.out, ["FIRE"], "stream")
            c.expect(!s.sim.machine.spaceDown && !s.sim.machine.nDown, "keys released")
        },
        CheckCase(name: "release space before N still clean") { c in
            var s = Stream()
            s.down(.space); s.wait(50); s.down(.n); s.wait(20); s.up(.space); s.wait(20); s.up(.n)
            c.equal(s.out, ["FIRE"], "stream")
            c.expect(!s.sim.machine.spaceConsumed && !s.sim.machine.nConsumed, "no leftover chord state")
        },
        CheckCase(name: "space tap alone is replayed (typing a space works)") { c in
            var s = Stream()
            s.down(.space); s.wait(60); s.up(.space)
            c.equal(s.out, ["space↓", "space↑"], "stream")
            c.equal(s.fires, 0, "fires")
        },
        CheckCase(name: "space then other key replays space before the key") { c in
            var s = Stream()
            s.down(.space); s.wait(30); s.down(keyA); s.up(keyA); s.up(.space)
            c.equal(s.out, ["space↓", "k0↓", "k0↑", "space↑"], "stream")
        },
        CheckCase(name: "fast typing: space up before next key") { c in
            var s = Stream()
            s.down(keyA); s.up(keyA); s.down(.space); s.wait(40); s.up(.space); s.down(.n); s.up(.n)
            c.equal(s.out, ["k0↓", "k0↑", "space↓", "space↑", "n↓", "n↑"], "stream")
            c.equal(s.fires, 0, "fires")
        },
        CheckCase(name: "rolled typing ' n' after other key is not a chord") { c in
            // "a" pressed while space held replays space; a later N is normal.
            var s = Stream()
            s.down(.space); s.down(keyA); s.down(.n); s.up(.space); s.up(keyA); s.up(.n)
            c.equal(s.fires, 0, "fires")
            c.equal(s.out, ["space↓", "k0↓", "n↓", "space↑", "k0↑", "n↑"], "stream")
        },
        CheckCase(name: "N without space passes through") { c in
            var s = Stream()
            s.down(.n); s.up(.n)
            c.equal(s.out, ["n↓", "n↑"], "stream")
        },
        CheckCase(name: "N held then space is not a chord") { c in
            var s = Stream()
            s.down(.n); s.down(.space); s.up(.n); s.up(.space)
            c.equal(s.fires, 0, "fires")
            c.equal(s.out, ["n↓", "n↑", "space↓", "space↑"], "stream")
        },
        CheckCase(name: "space autorepeat while buffered is swallowed, then chord") { c in
            var s = Stream()
            s.down(.space); s.wait(500)
            for _ in 0..<5 { s.down(.space, repeat: true); s.wait(30) }
            s.down(.n); s.up(.n); s.up(.space)
            c.equal(s.out, ["FIRE"], "stream")
        },
        CheckCase(name: "N autorepeat after chord never double-fires") { c in
            var s = Stream()
            s.down(.space); s.wait(50); s.down(.n)
            for _ in 0..<10 { s.wait(30); s.down(.n, repeat: true) }
            s.up(.n); s.up(.space)
            c.equal(s.fires, 1, "fires")
            c.equal(s.out, ["FIRE"], "stream")
        },
        CheckCase(name: "space autorepeat after chord is swallowed") { c in
            var s = Stream()
            s.down(.space); s.down(.n); s.up(.n)
            for _ in 0..<5 { s.down(.space, repeat: true) }
            s.up(.space)
            c.equal(s.out, ["FIRE"], "stream")
        },
        CheckCase(name: "space held, replayed by other key, then autorepeat passes") { c in
            var s = Stream()
            s.down(.space); s.down(keyA); s.up(keyA); s.down(.space, repeat: true); s.up(.space)
            c.equal(s.out, ["space↓", "k0↓", "k0↑", "space↻", "space↑"], "stream")
        },
        CheckCase(name: "second N tap while space still held fires again (deliberate press)") { c in
            var s = Stream()
            s.down(.space); s.down(.n); s.up(.n); s.wait(200); s.down(.n); s.up(.n); s.up(.space)
            c.equal(s.fires, 2, "fires")
            c.equal(s.out, ["FIRE", "FIRE"], "stream")
        },
        CheckCase(name: "two separate chords fire twice") { c in
            var s = Stream()
            for _ in 0..<2 { s.down(.space); s.wait(60); s.down(.n); s.up(.n); s.up(.space); s.wait(500) }
            c.equal(s.fires, 2, "fires")
        },
        CheckCase(name: "min hold: N too early types normally") { c in
            var s = Stream(.init(minHoldMs: 120))
            s.down(.space); s.wait(50); s.down(.n); s.up(.n); s.up(.space)
            c.equal(s.fires, 0, "fires")
            c.equal(s.out, ["space↓", "n↓", "n↑", "space↑"], "stream")
        },
        CheckCase(name: "min hold: N after threshold fires") { c in
            var s = Stream(.init(minHoldMs: 120))
            s.down(.space); s.wait(130); s.down(.n); s.up(.n); s.up(.space)
            c.equal(s.out, ["FIRE"], "stream")
        },
        CheckCase(name: "max hold: N too late types normally") { c in
            var s = Stream(.init(maxHoldMs: 1000))
            s.down(.space); s.wait(1500); s.down(.n); s.up(.n); s.up(.space)
            c.equal(s.fires, 0, "fires")
            c.equal(s.out, ["space↓", "n↓", "n↑", "space↑"], "stream")
        },
        CheckCase(name: "max hold boundary is inclusive") { c in
            var s = Stream(.init(minHoldMs: 100, maxHoldMs: 200))
            s.down(.space); s.wait(200); s.down(.n); s.up(.n); s.up(.space)
            c.equal(s.fires, 1, "fires")
        },
        CheckCase(name: "held_ms reported on chord") { c in
            var sim = Sim()
            sim.down(.space); sim.wait(87)
            let d = sim.down(.n)
            c.equal(d.label, "chord", "label")
            c.equal(d.heldMs, 87, "held")
        },
        CheckCase(name: "modified space (Cmd+Space) passes through untouched") { c in
            var s = Stream()
            s.down(.space, mods: true); s.down(.n); s.up(.n); s.up(.space)
            c.equal(s.fires, 0, "fires")
            c.equal(s.out, ["space↓", "n↓", "n↑", "space↑"], "stream")
        },
        CheckCase(name: "modified N (Shift+N) replays space, no chord") { c in
            var s = Stream()
            s.down(.space); s.down(.n, mods: true); s.up(.n); s.up(.space)
            c.equal(s.fires, 0, "fires")
            c.equal(s.out, ["space↓", "n↓", "n↑", "space↑"], "stream")
        },
        CheckCase(name: "fire on N key-up: arm on down, fire on up, exactly once") { c in
            var s = Stream(.init(fireOn: .nKeyUp))
            s.down(.space); s.wait(60); s.down(.n)
            c.equal(s.fires, 0, "fires after N down")
            s.down(.n, repeat: true); s.wait(40); s.up(.n)
            c.equal(s.fires, 1, "fires after N up")
            s.up(.space)
            c.equal(s.out, ["FIRE"], "stream")
        },
        CheckCase(name: "fire on N key-up works when space released first") { c in
            var s = Stream(.init(fireOn: .nKeyUp))
            s.down(.space); s.down(.n); s.up(.space); s.up(.n)
            c.equal(s.out, ["FIRE"], "stream")
        },
        CheckCase(name: "fire on N key-up: reset disarms (no late fire)") { c in
            var s = Stream(.init(fireOn: .nKeyUp))
            s.down(.space); s.down(.n)
            s.sim.machine.reset()
            s.up(.n); s.up(.space)
            c.equal(s.fires, 0, "fires")
        },
        CheckCase(name: "reset reports a buffered space that needs replay") { c in
            var sim = Sim()
            sim.down(.space)
            c.expect(sim.machine.reset(), "needs replay when buffered")
            c.expect(!sim.machine.reset(), "nothing to replay after reset")
        },
        CheckCase(name: "missed space key-up: next fresh press is not swallowed forever") { c in
            // Chord fired, then the space key-up was lost (tap disabled).
            var s = Stream()
            s.down(.space); s.down(.n); s.up(.n)
            // No space up. User now types a normal space.
            s.wait(2000); s.down(.space); s.up(.space)
            c.equal(s.out, ["FIRE", "space↓", "space↑"], "stream")
        },
        CheckCase(name: "missed space key-up while buffered: old space replayed, not lost") { c in
            var s = Stream()
            s.down(.space)
            s.down(.space)  // fresh (non-repeat) down: previous up was missed
            s.up(.space)
            c.equal(s.out, ["space↓", "space↓", "space↑"], "stream")
        },
        CheckCase(name: "missed N key-up: next fresh N types normally") { c in
            var s = Stream()
            s.down(.space); s.down(.n); s.up(.space)  // N up missed
            s.wait(1000); s.down(.n); s.up(.n)
            c.equal(s.out, ["FIRE", "n↓", "n↑"], "stream")
        },
        CheckCase(name: "other key while chord space held passes through") { c in
            var s = Stream()
            s.down(.space); s.down(.n); s.up(.n); s.down(keyB); s.up(keyB); s.up(.space)
            c.equal(s.out, ["FIRE", "k11↓", "k11↑"], "stream")
        },
    ]

    // MARK: - Delivery plan

    static let deliveryCases: [CheckCase] = [
        CheckCase(name: "bridge plan is Ctrl↓ Shift↓ 7↓ 7↑ Shift↑ Ctrl↑") { c in
            let plan = DeliveryPlan.bridgeShortcut(gapMs: 10)
            c.equal(plan.map { "\($0.key.rawValue)\($0.isDown ? "↓" : "↑")" },
                    ["control↓", "shift↓", "seven↓", "seven↑", "shift↑", "control↑"], "order")
            c.equal(plan.map(\.delayMs), [0, 10, 10, 10, 10, 10], "gaps")
        },
        CheckCase(name: "bridge plan releases every key; last event has no modifier flags") { c in
            let plan = DeliveryPlan.bridgeShortcut(gapMs: 5)
            c.equal(DeliveryPlan.keysHeld(after: plan), [], "held after plan")
            c.equal(plan.last?.flags, [], "final flags")
            c.equal(plan.first(where: { $0.key == .seven && $0.isDown })?.flags, [.control, .shift], "7 carries Ctrl+Shift")
        },
        CheckCase(name: "flags match modifier state after each event (no stale modifier)") { c in
            // Each event carries the modifier state AFTER it: Shift-up has only
            // Control, Control-up has none.
            let plan = DeliveryPlan.bridgeShortcut(gapMs: 5)
            var held = Set<BridgeKey>()
            for step in plan {
                if step.isDown { held.insert(step.key) } else { held.remove(step.key) }
                var expected = Set<BridgeModifier>()
                if held.contains(.control) { expected.insert(.control) }
                if held.contains(.shift) { expected.insert(.shift) }
                c.equal(step.flags, expected, "flags at \(step.key.rawValue)\(step.isDown ? "↓" : "↑")")
            }
        },
        CheckCase(name: "aborted sequence: release steps free all held keys") { c in
            let plan = DeliveryPlan.bridgeShortcut(gapMs: 5)
            for posted in 0...plan.count {
                let ups = DeliveryPlan.releaseSteps(for: plan, postedCount: posted)
                let all = Array(plan.prefix(posted)) + ups
                c.equal(DeliveryPlan.keysHeld(after: all), [], "held after abort at \(posted)")
                c.expect(ups.allSatisfy { !$0.isDown }, "release steps are all key-ups")
                if let last = ups.last { c.equal(last.flags, [], "final release flags at \(posted)") }
            }
            c.equal(DeliveryPlan.releaseSteps(for: plan, postedCount: 3).map(\.key), [.seven, .shift, .control], "reverse order")
        },
        CheckCase(name: "variants map to source, location and trigger") { c in
            c.equal(DeliveryVariant.default, .asyncHIDPrivate, "default")
            c.equal(DeliveryVariant.asyncHIDPrivate.source, .privateState, "a source")
            c.equal(DeliveryVariant.asyncHIDPrivate.location, .hid, "a location")
            c.equal(DeliveryVariant.hidSystemSource.source, .hidSystemState, "b source")
            c.equal(DeliveryVariant.sessionTap.location, .session, "c location")
            c.equal(DeliveryVariant.fireOnNKeyUp.fireOn, .nKeyUp, "d trigger")
            c.expect(DeliveryVariant.allCases.filter { $0 != .fireOnNKeyUp }.allSatisfy { $0.fireOn == .nKeyDown }, "others fire on key-down")
            c.equal(DeliveryVariant(rawValue: "c"), .sessionTap, "persisted raw value round-trips")
        },
        CheckCase(name: "settings defaults and clamping") { c in
            let d = DeliverySettings()
            c.equal(d.scheduleDelayMs, 20, "schedule delay")
            c.expect(!d.retryEnabled, "retry off by default")
            c.equal(d.retryDelayMs, 300, "retry delay")
            let wild = DeliverySettings(scheduleDelayMs: -5, gapMs: 999, retryDelayMs: 1).clamped()
            c.equal(wild.scheduleDelayMs, 0, "min delay")
            c.equal(wild.gapMs, 50, "max gap")
            c.equal(wild.retryDelayMs, 50, "min retry delay")
        },
    ]
}
