// Swift Testing wrapper around the shared checks. With a full Xcode install,
// `swift test` runs every check here. With Command Line Tools only, SwiftPM
// builds this target but does not execute it; use
// `swift run ChordCoreTestRunner` (see README).
#if canImport(Testing)
import ChordCoreChecks
import Testing

@Test(arguments: ChordCoreChecks.all.map(\.name))
func chordCoreCheck(_ name: String) {
    guard let check = ChordCoreChecks.all.first(where: { $0.name == name }) else {
        Issue.record("unknown check \(name)")
        return
    }
    let checker = Checker()
    check.run(checker)
    #expect(checker.failures.isEmpty, "\(checker.failures.joined(separator: "; "))")
}
#endif
