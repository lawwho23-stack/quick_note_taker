import AppKit
import ApplicationServices

/// Thin wrappers around the macOS permission APIs the helper needs.
///
/// - Posting synthetic key events requires **Accessibility**
///   (Privacy & Security → Accessibility).
/// - Receiving key events through an event tap requires **Input Monitoring**
///   (Privacy & Security → Input Monitoring).
public enum Permissions {
    public static var canPostEvents: Bool { CGPreflightPostEventAccess() }
    public static var canListenEvents: Bool { CGPreflightListenEventAccess() }

    /// Triggers the system prompt once per app identity (if not yet decided).
    public static func requestPostEvents() { _ = CGRequestPostEventAccess() }
    public static func requestListenEvents() { _ = CGRequestListenEventAccess() }

    public static func openAccessibilitySettings() {
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    }

    public static func openInputMonitoringSettings() {
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
    }

    private static func open(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        NSWorkspace.shared.open(url)
    }
}
