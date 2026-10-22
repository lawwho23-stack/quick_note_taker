import ChordCore
import Foundation

/// Persists helper choices in UserDefaults (domain: the app's bundle id,
/// `com.laww.quicknote.helper`).
///
/// Menu-controlled: chord mode, delivery variant, retry.
/// Advanced, via `defaults write com.laww.quicknote.helper <key> -float <ms>`:
/// `scheduleDelayMs` (default 20), `gapMs` (default 10), `retryDelayMs` (default 300).
enum HelperSettings {
    private static let defaults = UserDefaults.standard

    enum Key {
        static let mode = "chordMode"
        static let variant = "deliveryVariant"
        static let retry = "retryEnabled"
        static let scheduleDelay = "scheduleDelayMs"
        static let gap = "gapMs"
        static let retryDelay = "retryDelayMs"
    }

    static func loadMode() -> ChordTap.Mode {
        defaults.string(forKey: Key.mode).flatMap(ChordTap.Mode.init(rawValue:)) ?? .plain
    }

    static func save(mode: ChordTap.Mode) {
        defaults.set(mode.rawValue, forKey: Key.mode)
    }

    static func loadDelivery() -> DeliverySettings {
        let base = DeliverySettings()
        func ms(_ key: String, _ fallback: Double) -> Double {
            defaults.object(forKey: key) == nil ? fallback : defaults.double(forKey: key)
        }
        return DeliverySettings(
            variant: defaults.string(forKey: Key.variant).flatMap(DeliveryVariant.init(rawValue:)) ?? .default,
            scheduleDelayMs: ms(Key.scheduleDelay, base.scheduleDelayMs),
            gapMs: ms(Key.gap, base.gapMs),
            retryEnabled: defaults.bool(forKey: Key.retry),
            retryDelayMs: ms(Key.retryDelay, base.retryDelayMs)
        ).clamped()
    }

    /// Only the menu-controlled fields are written; timing stays as configured.
    static func save(delivery: DeliverySettings) {
        defaults.set(delivery.variant.rawValue, forKey: Key.variant)
        defaults.set(delivery.retryEnabled, forKey: Key.retry)
    }
}
