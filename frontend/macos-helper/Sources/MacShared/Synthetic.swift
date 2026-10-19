import CoreGraphics
import Foundation

/// Marks and recognises events posted by Quick Note tools, so the helper's
/// event tap never processes its own synthetic output (recursion guard).
public enum Synthetic {
    /// Magic value stored in `eventSourceUserData` on every event we post.
    static let marker: Int64 = 0x514E_4D30  // "QNM0"

    public static func mark(_ event: CGEvent) {
        event.setIntegerValueField(.eventSourceUserData, value: marker)
    }

    public static func isOurs(_ event: CGEvent) -> Bool {
        if event.getIntegerValueField(.eventSourceUserData) == marker {
            return true
        }
        // Fallback: events posted by this process carry its pid as the source.
        return event.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid())
    }
}
