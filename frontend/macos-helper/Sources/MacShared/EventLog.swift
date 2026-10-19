import Foundation

/// Appends JSON-lines diagnostic events to
/// `~/Library/Application Support/QuickNoteHelper/events.jsonl`.
///
/// Logs timing and state only — never note text, never full keystrokes, and
/// nothing ever leaves this Mac. Used to measure the M0 chord behaviour.
public final class EventLog {
    public static let shared = EventLog()

    public let directoryURL: URL
    public let fileURL: URL

    private var handle: FileHandle?

    private init() {
        let base = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent("QuickNoteHelper", isDirectory: true)
        directoryURL = base
        fileURL = base.appendingPathComponent("events.jsonl")
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        }
        handle = try? FileHandle(forWritingTo: fileURL)
        handle?.seekToEndOfFile()
    }

    /// Written from the main thread only (event tap callbacks and menu actions
    /// both run on the main run loop), so no locking is needed.
    public func log(_ type: String, _ fields: [String: Any] = [:]) {
        var object: [String: Any] = ["ts": Date().timeIntervalSince1970, "type": type]
        for (key, value) in fields {
            object[key] = value
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: object),
            var line = String(data: data, encoding: .utf8)
        else { return }
        line += "\n"
        if let lineData = line.data(using: .utf8) {
            handle?.write(lineData)
        }
    }
}
