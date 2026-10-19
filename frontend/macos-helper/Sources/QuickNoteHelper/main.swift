import AppKit

let app = NSApplication.shared
let delegate = HelperAppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)  // menu bar only, no dock icon
app.run()
