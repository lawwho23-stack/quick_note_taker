import AppKit
import Carbon
import ChordCore
import MacShared

/// Menu-bar controller: status, pause/resume, chord mode, delivery variant,
/// retry, permissions, log.
final class HelperAppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let chordTap = ChordTap(mode: HelperSettings.loadMode(), settings: HelperSettings.loadDelivery())
    private var stateTimer: Timer?
    /// Keeps App Nap from coalescing the delivery timers (20 ms delay, 10 ms gaps).
    private var latencyActivity: NSObjectProtocol?

    private var statusHeaderItem: NSMenuItem!
    private var pauseItem: NSMenuItem!
    private var plainItem: NSMenuItem!
    private var t120Item: NSMenuItem!
    private var t200Item: NSMenuItem!
    private var variantItems: [DeliveryVariant: NSMenuItem] = [:]
    private var retryItem: NSMenuItem!
    private var accessibilityItem: NSMenuItem!
    private var listenItem: NSMenuItem!
    private var secureInputItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        latencyActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .latencyCritical],
            reason: "Space+N chord delivery"
        )
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "◔ QN"
        buildMenu()

        let s = chordTap.settings
        EventLog.shared.log("helper_started", [
            "mode": chordTap.mode.rawValue, "variant": s.variant.rawValue, "retry": s.retryEnabled,
            "schedule_delay_ms": s.scheduleDelayMs, "gap_ms": s.gapMs, "retry_delay_ms": s.retryDelayMs,
        ])

        if !chordTap.start() {
            EventLog.shared.log("tap_not_started_waiting_for_permissions")
        }

        Permissions.requestListenEvents()
        Permissions.requestPostEvents()

        stateTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshState()
        }
        refreshState()
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Never leave a buffered space or a synthetic modifier pressed on quit.
        chordTap.shutdown()
        EventLog.shared.log("helper_terminating")
    }

    private func buildMenu() {
        let menu = NSMenu()

        statusHeaderItem = NSMenuItem(title: "Quick Note Helper", action: nil, keyEquivalent: "")
        statusHeaderItem.isEnabled = false
        menu.addItem(statusHeaderItem)
        menu.addItem(.separator())

        pauseItem = NSMenuItem(title: "Pause capture", action: #selector(togglePause), keyEquivalent: "")
        pauseItem.target = self
        menu.addItem(pauseItem)

        let modeMenu = NSMenu()
        plainItem = NSMenuItem(title: ChordTap.Mode.plain.rawValue, action: #selector(setModePlain), keyEquivalent: "")
        t120Item = NSMenuItem(title: ChordTap.Mode.threshold120.rawValue, action: #selector(setMode120), keyEquivalent: "")
        t200Item = NSMenuItem(title: ChordTap.Mode.threshold200.rawValue, action: #selector(setMode200), keyEquivalent: "")
        for item in [plainItem, t120Item, t200Item] {
            item?.target = self
            modeMenu.addItem(item!)
        }
        let modeItem = NSMenuItem(title: "Chord mode", action: nil, keyEquivalent: "")
        modeItem.submenu = modeMenu
        menu.addItem(modeItem)

        let variantMenu = NSMenu()
        for variant in DeliveryVariant.allCases {
            let item = NSMenuItem(title: variant.title, action: #selector(selectVariant(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = variant.rawValue
            variantMenu.addItem(item)
            variantItems[variant] = item
        }
        let variantItem = NSMenuItem(title: "Delivery variant", action: nil, keyEquivalent: "")
        variantItem.submenu = variantMenu
        menu.addItem(variantItem)

        retryItem = NSMenuItem(title: "Retry once after 300 ms", action: #selector(toggleRetry), keyEquivalent: "")
        retryItem.target = self
        menu.addItem(retryItem)

        menu.addItem(.separator())

        accessibilityItem = NSMenuItem(title: "Accessibility: …", action: nil, keyEquivalent: "")
        accessibilityItem.isEnabled = false
        listenItem = NSMenuItem(title: "Input Monitoring: …", action: nil, keyEquivalent: "")
        listenItem.isEnabled = false
        secureInputItem = NSMenuItem(title: "Secure input: …", action: nil, keyEquivalent: "")
        secureInputItem.isEnabled = false
        menu.addItem(accessibilityItem)
        menu.addItem(listenItem)
        menu.addItem(secureInputItem)

        let grantItem = NSMenuItem(title: "Request permissions…", action: #selector(requestPermissions), keyEquivalent: "")
        grantItem.target = self
        menu.addItem(grantItem)
        let accSettings = NSMenuItem(title: "Open Accessibility settings", action: #selector(openAccessibility), keyEquivalent: "")
        accSettings.target = self
        menu.addItem(accSettings)
        let listenSettings = NSMenuItem(title: "Open Input Monitoring settings", action: #selector(openInputMonitoring), keyEquivalent: "")
        listenSettings.target = self
        menu.addItem(listenSettings)

        menu.addItem(.separator())

        let logItem = NSMenuItem(title: "Open log folder", action: #selector(openLogFolder), keyEquivalent: "")
        logItem.target = self
        menu.addItem(logItem)

        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Quit Quick Note Helper", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    @objc private func togglePause() {
        if chordTap.isPaused {
            chordTap.isPaused = false
            EventLog.shared.log("resumed")
        } else {
            chordTap.drainBuffer()
            chordTap.isPaused = true
            EventLog.shared.log("paused")
        }
        refreshState()
    }

    @objc private func setModePlain() { setMode(.plain) }
    @objc private func setMode120() { setMode(.threshold120) }
    @objc private func setMode200() { setMode(.threshold200) }

    private func setMode(_ mode: ChordTap.Mode) {
        chordTap.mode = mode
        HelperSettings.save(mode: mode)
        refreshState()
    }

    @objc private func selectVariant(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let variant = DeliveryVariant(rawValue: raw) else { return }
        chordTap.settings.variant = variant
        HelperSettings.save(delivery: chordTap.settings)
        refreshState()
    }

    @objc private func toggleRetry() {
        chordTap.settings.retryEnabled.toggle()
        HelperSettings.save(delivery: chordTap.settings)
        refreshState()
    }

    @objc private func requestPermissions() {
        Permissions.requestListenEvents()
        Permissions.requestPostEvents()
        refreshState()
    }

    @objc private func openAccessibility() { Permissions.openAccessibilitySettings() }
    @objc private func openInputMonitoring() { Permissions.openInputMonitoringSettings() }

    @objc private func openLogFolder() {
        NSWorkspace.shared.open(EventLog.shared.directoryURL)
    }

    private func refreshState() {
        // Retry starting the tap once permissions arrive.
        if !chordTap.isRunning && Permissions.canPostEvents && Permissions.canListenEvents {
            chordTap.start()
        }

        let tapState: String
        if !chordTap.isRunning {
            tapState = "waiting for permissions"
        } else if chordTap.isPaused {
            tapState = "paused"
        } else {
            tapState = "running — mode: \(chordTap.mode.rawValue), variant \(chordTap.settings.variant.rawValue)"
        }
        statusItem.button?.title = (chordTap.isRunning && !chordTap.isPaused) ? "◉ QN" : "◔ QN"
        statusHeaderItem.title = "Quick Note Helper — \(tapState)"

        pauseItem.title = chordTap.isPaused ? "Resume capture" : "Pause capture"
        plainItem.state = chordTap.mode == .plain ? .on : .off
        t120Item.state = chordTap.mode == .threshold120 ? .on : .off
        t200Item.state = chordTap.mode == .threshold200 ? .on : .off
        for (variant, item) in variantItems {
            item.state = chordTap.settings.variant == variant ? .on : .off
        }
        retryItem.title = "Retry once after \(Int(chordTap.settings.retryDelayMs)) ms"
        retryItem.state = chordTap.settings.retryEnabled ? .on : .off

        accessibilityItem.title = "Accessibility: \(Permissions.canPostEvents ? "granted ✓" : "not granted ✗")"
        listenItem.title = "Input Monitoring: \(Permissions.canListenEvents ? "granted ✓" : "not granted ✗")"
        secureInputItem.title = "Secure input: \(IsSecureEventInputEnabled() ? "active — macOS blocks capture" : "off")"
    }
}
