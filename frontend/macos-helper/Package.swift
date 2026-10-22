// swift-tools-version:5.9
import PackageDescription

// ChordCore: pure chord logic + delivery plans (no CoreGraphics), unit-tested.
// MacShared: CoreGraphics glue (posting, logging, permissions).
// Tests use the Swift Testing framework (`import Testing`), which ships with
// the Command Line Tools; XCTest is only available with a full Xcode install.
let cltFrameworks = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"

let package = Package(
    name: "QuickNoteMac",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "ChordCore"),
        .target(name: "MacShared", dependencies: ["ChordCore"]),
        .executableTarget(name: "BridgeProbe", dependencies: ["MacShared"]),
        .executableTarget(name: "QuickNoteHelper", dependencies: ["MacShared", "ChordCore"]),
        // Shared test cases + a tiny harness, so the same checks run both as
        // an executable (`swift run ChordCoreTestRunner`) and under `swift test`.
        .target(name: "ChordCoreChecks", dependencies: ["ChordCore"], path: "Tests/ChordCoreChecks"),
        .executableTarget(name: "ChordCoreTestRunner", dependencies: ["ChordCoreChecks"], path: "Tests/ChordCoreTestRunner"),
        .testTarget(
            name: "ChordCoreTests",
            dependencies: ["ChordCoreChecks"],
            // Command Line Tools keep Testing.framework outside the default
            // search path; harmless when building with full Xcode.
            swiftSettings: [.unsafeFlags(["-F", cltFrameworks])],
            linkerSettings: [.unsafeFlags(["-F", cltFrameworks, "-Xlinker", "-rpath", "-Xlinker", cltFrameworks])]
        ),
    ]
)
