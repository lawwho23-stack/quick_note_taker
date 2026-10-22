import ChordCoreChecks
import Foundation

// Executable test runner: `swift run ChordCoreTestRunner`.
// Exits non-zero if any check fails.
var failed = 0
for check in ChordCoreChecks.all {
    let checker = Checker()
    check.run(checker)
    if checker.failures.isEmpty {
        print("PASS  \(check.name)")
    } else {
        failed += 1
        print("FAIL  \(check.name)")
        for failure in checker.failures { print("      \(failure)") }
    }
}
print("\(ChordCoreChecks.all.count - failed)/\(ChordCoreChecks.all.count) checks passed")
exit(failed == 0 ? 0 : 1)
