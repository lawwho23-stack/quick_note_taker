import AppKit
import MacShared

/// Bridge Probe — the M0 one-shot test.
///
/// Proves (or disproves) the hypothesis that a synthetic key event posted by
/// a local tool can trigger a Chrome extension command. It posts exactly the
/// same Control+Shift+7 combination the helper will use.
final class ProbeDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var permissionLabel: NSTextField!
    private var countdownLabel: NSTextField!
    private var countdownTimer: Timer?
    private var secondsLeft = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        EventLog.shared.log("probe_started")
        refreshPermissionStatus()
        Permissions.requestPostEvents()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 540, height: 340),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Quick Note — Bridge Probe (M0)"
        window.center()

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 24, bottom: 20, right: 24)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: "Can a synthetic key event trigger the Chrome command?")
        title.font = .boldSystemFont(ofSize: 14)

        let steps = NSTextField(wrappingLabelWithString: """
        1. Load the Quick Note extension in Chrome:
           chrome://extensions → Developer mode ON → Load unpacked → select frontend/extension.
        2. Focus Chrome and click anywhere in a page.
        3. Click “Run 5-second test”. After the countdown, this app posts
           Control+Shift+7 exactly like a real keyboard would.
        4. Expected: the Quick Note capture window opens. That proves the bridge works.
        """)
        steps.preferredMaxLayoutWidth = 480

        permissionLabel = NSTextField(wrappingLabelWithString: "")
        permissionLabel.preferredMaxLayoutWidth = 480
        countdownLabel = NSTextField(labelWithString: " ")
        countdownLabel.font = .systemFont(ofSize: 12)

        let runButton = NSButton(title: "Run 5-second test", target: self, action: #selector(runTest))
        runButton.bezelStyle = .rounded
        runButton.keyEquivalent = "\r"

        let grantButton = NSButton(title: "Grant permission…", target: self, action: #selector(requestPermission))
        grantButton.bezelStyle = .rounded

        let settingsButton = NSButton(title: "Open Accessibility settings", target: self, action: #selector(openSettings))
        settingsButton.bezelStyle = .rounded

        let buttons = NSStackView(views: [runButton, grantButton, settingsButton])
        buttons.orientation = .horizontal
        buttons.spacing = 8

        stack.addArrangedSubview(title)
        stack.addArrangedSubview(steps)
        stack.addArrangedSubview(permissionLabel)
        stack.addArrangedSubview(buttons)
        stack.addArrangedSubview(countdownLabel)

        let contentView = window.contentView!
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor),
        ])

        window.makeKeyAndOrderFront(nil)
    }

    @objc private func requestPermission() {
        Permissions.requestPostEvents()
        refreshPermissionStatus()
    }

    @objc private func openSettings() {
        Permissions.openAccessibilitySettings()
    }

    private func refreshPermissionStatus() {
        if Permissions.canPostEvents {
            permissionLabel.stringValue = "✅ Permission to post key events: granted."
        } else {
            permissionLabel.stringValue = """
            ❌ Permission to post key events: not granted.
            Click “Grant permission…”, then enable this app under
            System Settings → Privacy & Security → Accessibility.
            """
        }
    }

    @objc private func runTest() {
        guard Permissions.canPostEvents else {
            countdownLabel.stringValue = "Cannot post events yet — grant the permission first."
            refreshPermissionStatus()
            return
        }
        secondsLeft = 5
        countdownLabel.stringValue = "Posting in 5… (switch to Chrome now)"
        countdownTimer?.invalidate()
        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            guard let self else { return }
            self.secondsLeft -= 1
            if self.secondsLeft <= 0 {
                timer.invalidate()
                self.postBridgeShortcut()
            } else {
                self.countdownLabel.stringValue = "Posting in \(self.secondsLeft)… (switch to Chrome now)"
            }
        }
    }

    private func postBridgeShortcut() {
        BridgeShortcut.post()
        let stamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        countdownLabel.stringValue = "Posted \(BridgeShortcut.displayName) at \(stamp). Did the capture window open?"
        EventLog.shared.log("probe_posted")
    }
}

let app = NSApplication.shared
let delegate = ProbeDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
