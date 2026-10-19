// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "QuickNoteMac",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "MacShared"),
        .executableTarget(name: "BridgeProbe", dependencies: ["MacShared"]),
        .executableTarget(name: "QuickNoteHelper", dependencies: ["MacShared"]),
    ]
)
