import CoreGraphics
import Foundation

/// Posts the internal bridge shortcut (Control+Shift+7 on macOS) as synthetic
/// keyboard events.
///
/// The extension registers `MacCtrl+Shift+7` (Control+Shift+7 on macOS) as its
/// `open-capture` command. Chrome reserves global shortcuts for modifier
/// combinations, which is exactly why a helper is needed to deliver the
/// user-facing Space+N gesture.
public enum BridgeShortcut {
    /// The key combination delivered to the browser, for display purposes.
    public static let displayName = "Control+Shift+7"

    public static func post() {
        guard let source = CGEventSource(stateID: .privateState) else { return }

        func post(_ event: CGEvent?, gapMicros: UInt32) {
            guard let event else { return }
            Synthetic.mark(event)
            event.post(tap: .cghidEventTap)
            if gapMicros > 0 {
                usleep(gapMicros)
            }
        }

        let controlDown = CGEvent(keyboardEventSource: source, virtualKey: KeyCodes.control, keyDown: true)
        controlDown?.flags = .maskControl
        post(controlDown, gapMicros: 5_000)

        let shiftDown = CGEvent(keyboardEventSource: source, virtualKey: KeyCodes.shift, keyDown: true)
        shiftDown?.flags = [.maskControl, .maskShift]
        post(shiftDown, gapMicros: 5_000)

        let sevenDown = CGEvent(keyboardEventSource: source, virtualKey: KeyCodes.seven, keyDown: true)
        sevenDown?.flags = [.maskControl, .maskShift]
        post(sevenDown, gapMicros: 5_000)

        let sevenUp = CGEvent(keyboardEventSource: source, virtualKey: KeyCodes.seven, keyDown: false)
        sevenUp?.flags = [.maskControl, .maskShift]
        post(sevenUp, gapMicros: 5_000)

        let shiftUp = CGEvent(keyboardEventSource: source, virtualKey: KeyCodes.shift, keyDown: false)
        shiftUp?.flags = .maskControl
        post(shiftUp, gapMicros: 5_000)

        let controlUp = CGEvent(keyboardEventSource: source, virtualKey: KeyCodes.control, keyDown: false)
        controlUp?.flags = []
        post(controlUp, gapMicros: 0)
    }
}
