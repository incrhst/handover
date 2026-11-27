// Handover for macOS: a window around app/web/index.html, plus the parts a web
// page can't do reliably on its own: real files on disk, a clock that keeps
// running, the daily task sheet, nightly backups and opening at login.
//
// Data folder (default ~/Documents/Handover, or $HANDOVER_DATA):
//   handovers/<id>.handover   the content of each handover, as loaded
//   progress/<id>.json        ticks, notes and first-seen date
//   daily/<id>-<date>.md      the task sheet, written each morning
//   backups/<date>/           a copy of handovers/ and progress/, last 30 days

import AppKit
import CryptoKit
import ServiceManagement
import UniformTypeIdentifiers
import WebKit

let handoverType = UTType(exportedAs: "io.github.incrhst.handover", conformingTo: .json)
let idPattern = try! NSRegularExpression(pattern: "^[a-z0-9][a-z0-9-]{0,63}$")
func validID(_ s: String) -> Bool { idPattern.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil }

final class Store {
    let defaults = UserDefaults.standard
    var root: URL {
        if let env = ProcessInfo.processInfo.environment["HANDOVER_DATA"], !env.isEmpty { return URL(fileURLWithPath: env, isDirectory: true) }
        if let p = defaults.string(forKey: "dataFolder") { return URL(fileURLWithPath: p, isDirectory: true) }
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Handover", isDirectory: true)
    }
    func dir(_ name: String) -> URL {
        let u = root.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }
    var last: String? {
        get { defaults.string(forKey: "lastHandover") }
        set { defaults.set(newValue, forKey: "lastHandover") }
    }
    func source(_ id: String) -> String? {
        guard validID(id) else { return nil }
        return try? String(contentsOf: dir("handovers").appendingPathComponent("\(id).handover"), encoding: .utf8)
    }
    func state(_ id: String) -> Any? {
        guard validID(id), let d = try? Data(contentsOf: dir("progress").appendingPathComponent("\(id).json")) else { return nil }
        return try? JSONSerialization.jsonObject(with: d)
    }
    func writeSource(_ id: String, _ text: String) throws {
        guard validID(id) else { throw CocoaError(.fileWriteInvalidFileName) }
        try Data(text.utf8).write(to: dir("handovers").appendingPathComponent("\(id).handover"), options: .atomic)
    }
    func writeState(_ id: String, _ state: Any) throws {
        guard validID(id) else { throw CocoaError(.fileWriteInvalidFileName) }
        let d = try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
        try d.write(to: dir("progress").appendingPathComponent("\(id).json"), options: .atomic)
    }
    func library() -> [[String: String]] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir("handovers"), includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "handover" }.compactMap { u in
            let id = u.deletingPathExtension().lastPathComponent
            guard let d = try? Data(contentsOf: u), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
            return ["id": id, "title": (o["title"] as? String) ?? id]
        }.sorted { $0["title"]! < $1["title"]! }
    }
    /// Once a day: copy handovers/ and progress/ into backups/<date>/, keeping the newest 30.
    func backupIfNeeded() {
        let fm = FileManager.default
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        let day = dir("backups").appendingPathComponent(f.string(from: Date()), isDirectory: true)
        guard !fm.fileExists(atPath: day.path) else { return }
        let sources = ["handovers", "progress"].map { dir($0) }
        guard sources.contains(where: { !((try? fm.contentsOfDirectory(atPath: $0.path)) ?? []).isEmpty }) else { return }
        do {
            try fm.createDirectory(at: day, withIntermediateDirectories: true)
            for s in sources { try fm.copyItem(at: s, to: day.appendingPathComponent(s.lastPathComponent)) }
        } catch { NSLog("Handover backup failed: \(error)") }
        let all = ((try? fm.contentsOfDirectory(atPath: dir("backups").path)) ?? []).filter { $0.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil }.sorted()
        for old in all.dropLast(30) { try? fm.removeItem(at: dir("backups").appendingPathComponent(old)) }
    }
    /// Move to a new folder, copying across anything not already there.
    func moveTo(_ newRoot: URL) {
        let fm = FileManager.default
        for name in ["handovers", "progress", "daily"] {
            let from = dir(name), to = newRoot.appendingPathComponent(name, isDirectory: true)
            try? fm.createDirectory(at: to, withIntermediateDirectories: true)
            for item in (try? fm.contentsOfDirectory(atPath: from.path)) ?? [] {
                let dest = to.appendingPathComponent(item)
                if !fm.fileExists(atPath: dest.path) { try? fm.copyItem(at: from.appendingPathComponent(item), to: dest) }
            }
        }
        defaults.set(newRoot.path, forKey: "dataFolder")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let store = Store()
    let updater = Updater()
    var window: NSWindow!
    var web: WKWebView!
    var ready = false
    var pendingOpens: [URL] = []
    var timer: Timer?
    var titleObs: NSKeyValueObservation?

    var webDir: URL { Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true) }

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "handover")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Handover"
        window.minSize = NSSize(width: 420, height: 480)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("HandoverMain")
        window.tabbingMode = .disallowed
        titleObs = web.observe(\.title, options: [.new]) { [weak self] w, _ in self?.window.title = (w.title?.isEmpty == false) ? w.title! : "Handover" }

        web.loadFileURL(webDir.appendingPathComponent("index.html"), allowingReadAccessTo: webDir)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        store.backupIfNeeded()
        updater.host = self
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.updater.checkIfDue() }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.tick() }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.tick() }
    }

    func tick() {
        store.backupIfNeeded()
        updater.checkIfDue()
        if ready { web.evaluateJavaScript("window.handoverTick && window.handoverTick()", completionHandler: nil) }
    }

    // Keep running with the window closed, so the daily sheet still gets written.
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows: Bool) -> Bool { showWindow(); return true }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }

    // Files opened from Finder, the Dock or "Open With"
    func application(_ application: NSApplication, open urls: [URL]) {
        if ready { urls.forEach(importFile) } else { pendingOpens += urls }
        if window != nil { showWindow() }
    }
    func importFile(_ url: URL) {
        guard let data = try? Data(contentsOf: url) else { alert("Couldn't read \(url.lastPathComponent)."); return }
        let text = String(decoding: data, as: UTF8.self)
        callJS("handoverImport", [text, url.lastPathComponent])
    }
    func callJS(_ fn: String, _ args: [Any]) {
        guard let json = try? JSONSerialization.data(withJSONObject: args), let list = String(data: json, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.\(fn).apply(null, \(list))", completionHandler: nil)
    }
    func command(_ name: String) { showWindow(); callJS("handoverCommand", [name]) }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        pendingOpens.forEach(importFile); pendingOpens = []
    }
    // Links: anything outside the app opens in the user's browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL || url.scheme == "about" { decisionHandler(.allow); return }
        if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let a = NSAlert(); a.messageText = message
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { ready = false; webView.reload() }

    func alert(_ text: String) { let a = NSAlert(); a.messageText = text; a.beginSheetModal(for: window, completionHandler: nil) }

    // MARK: Bridge. The page calls window.webkit.messageHandlers.handover.postMessage({action, payload}).

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { replyHandler(nil, "bad message"); return }
        let payload = (body["payload"] as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8), options: [.fragmentsAllowed]) } as? [String: Any] ?? [:]
        func reply(_ obj: Any?) {
            guard let obj = obj, let d = try? JSONSerialization.data(withJSONObject: obj, options: [.fragmentsAllowed]) else { replyHandler(nil, nil); return }
            replyHandler(String(data: d, encoding: .utf8), nil)
        }
        func str(_ k: String) -> String { (payload[k] as? String) ?? "" }

        switch action {
        case "init":
            var r: [String: Any] = ["library": store.library(), "dataFolder": store.root.path, "loginItem": SMAppService.mainApp.status == .enabled, "version": updater.current, "autoUpdate": updater.auto]
            if let id = store.last, let src = store.source(id) { r["source"] = src; r["state"] = store.state(id) ?? NSNull() }
            reply(r)
        case "adopt":
            let id = str("id")
            do { try store.writeSource(id, str("text")); store.last = id; reply(["state": store.state(id) ?? NSNull()]) }
            catch { alert("Couldn't save the handover: \(error.localizedDescription)"); reply(nil) }
        case "saveState":
            if let st = payload["state"] { do { try store.writeState(str("id"), st) } catch { NSLog("Handover: couldn't save progress: \(error)") } }
            reply(["ok": true])
        case "switchTo":
            let id = str("id")
            guard let src = store.source(id) else { reply(nil); return }
            store.last = id
            reply(["source": src, "state": store.state(id) ?? NSNull()])
        case "close":
            store.last = nil
            reply(["ok": true])
        case "open":
            let p = NSOpenPanel(); p.allowedContentTypes = [handoverType, .json]; p.allowsMultipleSelection = false
            p.beginSheetModal(for: window) { r in
                guard r == .OK, let u = p.url, let d = try? Data(contentsOf: u) else { reply(nil); return }
                reply(["text": String(decoding: d, as: UTF8.self), "name": u.lastPathComponent])
            }
        case "saveAs":
            let p = NSSavePanel(); p.nameFieldStringValue = str("filename"); p.title = str("title")
            p.allowedContentTypes = [handoverType]; p.isExtensionHidden = false
            p.beginSheetModal(for: window) { r in
                guard r == .OK, let u = p.url else { reply(nil); return }
                do { try Data(self.str(payload, "content").utf8).write(to: u, options: .atomic); reply(["path": u.path]) }
                catch { self.alert("Couldn't save: \(error.localizedDescription)"); reply(nil) }
            }
        case "exportSheet":
            let name = (str("filename") as NSString).lastPathComponent
            let dest = store.dir("daily").appendingPathComponent(name)
            if payload["auto"] as? Bool == true {
                do { try Data(str("content").utf8).write(to: dest, options: .atomic); NSLog("Handover: wrote \(dest.path)"); reply(["path": dest.path]) }
                catch { NSLog("Handover: daily sheet failed: \(error)"); reply(nil) }
                return
            }
            let p = NSSavePanel(); p.nameFieldStringValue = name; p.directoryURL = store.dir("daily"); p.title = "Save today's task sheet"
            p.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]; p.isExtensionHidden = false
            p.beginSheetModal(for: window) { r in
                guard r == .OK, let u = p.url else { reply(nil); return }
                do { try Data(self.str(payload, "content").utf8).write(to: u, options: .atomic); NSWorkspace.shared.activateFileViewerSelecting([u]); reply(["path": u.path]) }
                catch { self.alert("Couldn't save: \(error.localizedDescription)"); reply(nil) }
            }
        case "copy":
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(str("text"), forType: .string); reply(["ok": true])
        case "print":
            let info = NSPrintInfo.shared; info.topMargin = 36; info.bottomMargin = 36; info.leftMargin = 36; info.rightMargin = 36
            info.horizontalPagination = .fit; info.verticalPagination = .automatic
            let op = web.printOperation(with: info)
            op.view?.frame = web.bounds
            op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
            reply(["ok": true])
        case "sample":
            let name = str("name") == "ea-no-overlap.handover" ? "ea-no-overlap.handover" : "sample.handover"
            reply(["text": (try? String(contentsOf: webDir.appendingPathComponent(name), encoding: .utf8)) ?? ""])
        case "prompt":
            reply(["text": (try? String(contentsOf: webDir.appendingPathComponent("prompt.md"), encoding: .utf8)) ?? ""])
        case "reveal":
            NSWorkspace.shared.activateFileViewerSelecting([store.root]); reply(["ok": true])
        case "chooseFolder":
            let p = NSOpenPanel(); p.canChooseDirectories = true; p.canChooseFiles = false; p.canCreateDirectories = true
            p.prompt = "Use This Folder"; p.message = "Choose where Handover keeps its files. A folder in iCloud Drive or Google Drive is backed up automatically."
            p.beginSheetModal(for: window) { r in
                guard r == .OK, let u = p.url else { reply(nil); return }
                self.store.moveTo(u); reply(["path": u.path])
            }
        case "setLogin":
            let on = payload["on"] as? Bool ?? false
            var msg: String? = nil
            do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
            catch { msg = "Couldn't change it: \(error.localizedDescription)" }
            if SMAppService.mainApp.status == .requiresApproval { msg = "Allow Handover in System Settings > General > Login Items."; SMAppService.openSystemSettingsLoginItems() }
            var r: [String: Any] = ["enabled": SMAppService.mainApp.status == .enabled]
            if let m = msg { r["message"] = m }
            reply(r)
        case "checkUpdates":
            updater.check(userInitiated: true); reply(["ok": true])
        case "setAutoUpdate":
            updater.auto = payload["on"] as? Bool ?? true; reply(["enabled": updater.auto])
        case "log":
            NSLog("Handover page: \(str("msg"))"); reply(nil)
        default:
            replyHandler(nil, "unknown action \(action)")
        }
    }
    func str(_ payload: [String: Any], _ k: String) -> String { (payload[k] as? String) ?? "" }

    // MARK: Menus

    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.keyEquivalentModifierMask = mods; if let t = target { i.target = t }; return i
        }
        @discardableResult func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: ""); let m = NSMenu(title: title)
            items.forEach(m.addItem); top.submenu = m; main.addItem(top); return top
        }
        submenu("Handover", [
            item("About Handover", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), target: NSApp),
            item("Check for Updates…", #selector(checkForUpdates), target: self),
            .separator(),
            item("Show Data Folder", #selector(revealData), target: self),
            .separator(),
            item("Hide Handover", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit Handover", #selector(NSApplication.terminate(_:)), "q"),
        ])
        submenu("File", [
            item("Open Handover File…", #selector(openFileMenu), "o", target: self),
            item("Open the Example", #selector(openSample), target: self),
            item("Close Handover", #selector(closeHandover), "w", [.command, .shift], target: self),
            .separator(),
            item("Export Today's Task Sheet…", #selector(exportToday), "e", target: self),
            item("Share Handover File…", #selector(shareFile), "s", [.command, .shift], target: self),
            item("Export With My Progress…", #selector(exportProgress), target: self),
            .separator(),
            item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
            item("Print…", #selector(printPage), "p", target: self),
        ])
        submenu("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            item("Find…", #selector(find), "f", target: self),
        ])
        submenu("View", [
            item("Actual Size", #selector(zoomReset), "0", target: self),
            item("Zoom In", #selector(zoomIn), "+", target: self),
            item("Zoom Out", #selector(zoomOut), "-", target: self),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        let win = submenu("Window", [
            item("Handover", #selector(showWindow), "1", target: self),
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
        ])
        NSApp.windowsMenu = win.submenu
        let help = submenu("Help", [
            item("Handover Website", #selector(openSite), target: self),
            item("The Handover Format", #selector(openSpec), target: self),
            item("Copy the AI Prompt", #selector(copyPrompt), target: self),
        ])
        NSApp.helpMenu = help.submenu
        NSApp.mainMenu = main
    }

    @objc func openFileMenu() {
        showWindow()
        let p = NSOpenPanel(); p.allowedContentTypes = [handoverType, .json]
        p.beginSheetModal(for: window) { r in if r == .OK, let u = p.url { self.importFile(u) } }
    }
    @objc func openSample() { showWindow(); importFile(webDir.appendingPathComponent("ea-no-overlap.handover")) }
    @objc func closeHandover() { command("close") }
    @objc func exportToday() { command("exportToday") }
    @objc func shareFile() { command("shareFile") }
    @objc func exportProgress() { command("exportProgress") }
    @objc func printPage() { command("print") }
    @objc func find() { command("find") }
    @objc func checkForUpdates() { showWindow(); updater.check(userInitiated: true) }
    @objc func revealData() { NSWorkspace.shared.activateFileViewerSelecting([store.root]) }
    @objc func zoomReset() { web.pageZoom = 1 }
    @objc func zoomIn() { web.pageZoom = min(web.pageZoom + 0.1, 2) }
    @objc func zoomOut() { web.pageZoom = max(web.pageZoom - 0.1, 0.6) }
    @objc func openSite() { NSWorkspace.shared.open(URL(string: "https://incrhst.github.io/handover/")!) }
    @objc func openSpec() { NSWorkspace.shared.open(URL(string: "https://github.com/incrhst/handover/blob/main/spec/SPEC.md")!) }
    @objc func copyPrompt() {
        let text = (try? String(contentsOf: webDir.appendingPathComponent("prompt.md"), encoding: .utf8)) ?? ""
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
    }
}

// MARK: Updates
// Checks GitHub for a newer release, then downloads it, checks it and swaps it in.
// The new app must pass Apple's code-signing check and be signed by the same
// developer team as the running one, so only genuine releases can install.


final class Updater {
    weak var host: AppDelegate?
    let repo = "incrhst/handover"
    let defaults = UserDefaults.standard
    var busy = false
    var current: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }
    var auto: Bool {
        get { defaults.object(forKey: "autoUpdate") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "autoUpdate") }
    }
    var releasePage: URL { URL(string: "https://github.com/\(repo)/releases/latest")! }

    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }, y = b.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        for i in 0..<max(x.count, y.count) { let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0; if l != r { return l > r } }
        return false
    }

    func checkIfDue() {
        guard auto, !busy else { return }
        if let last = defaults.object(forKey: "lastUpdateCheck") as? Date, Date().timeIntervalSince(last) < 20 * 3600 { return }
        check(userInitiated: false)
    }

    func check(userInitiated: Bool) {
        guard !busy else { return }
        busy = true
        var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Handover/\(current)", forHTTPHeaderField: "User-Agent")
        req.timeoutInterval = 20
        URLSession.shared.dataTask(with: req) { data, resp, err in
            DispatchQueue.main.async {
                self.busy = false
                self.defaults.set(Date(), forKey: "lastUpdateCheck")
                guard let data = data, (resp as? HTTPURLResponse)?.statusCode == 200,
                      let rel = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let tag = rel["tag_name"] as? String else {
                    if userInitiated { self.host?.alert("Couldn't check for updates. Check your internet connection and try again.") }
                    return
                }
                let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
                guard Updater.newer(version, than: self.current) else {
                    if userInitiated { self.host?.alert("You have the latest version, Handover \(self.current).") }
                    return
                }
                if !userInitiated && self.defaults.string(forKey: "skipVersion") == version { return }
                let assets = (rel["assets"] as? [[String: Any]]) ?? []
                func asset(_ name: String) -> URL? { assets.first { $0["name"] as? String == name }.flatMap { $0["browser_download_url"] as? String }.flatMap(URL.init(string:)) }
                self.offer(version: version, notes: (rel["body"] as? String) ?? "", dmg: asset("Handover.dmg"), sha: asset("Handover.dmg.sha256"), page: (rel["html_url"] as? String).flatMap(URL.init(string:)) ?? self.releasePage, userInitiated: userInitiated)
            }
        }.resume()
    }

    func offer(version: String, notes: String, dmg: URL?, sha: URL?, page: URL, userInitiated: Bool) {
        guard let host = host else { return }
        host.showWindow()
        let a = NSAlert()
        a.messageText = "Handover \(version) is available"
        var info = "You have \(current)."
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { info += "\n\n" + (trimmed.count > 700 ? String(trimmed.prefix(700)) + "…" : trimmed) }
        a.informativeText = info
        a.addButton(withTitle: dmg != nil ? "Install and Relaunch" : "Open Download Page")
        a.addButton(withTitle: "Later")
        if !userInitiated { a.addButton(withTitle: "Skip This Version") }
        a.beginSheetModal(for: host.window) { r in
            switch r {
            case .alertFirstButtonReturn:
                if let dmg = dmg { self.install(dmg: dmg, sha: sha, version: version, page: page) } else { NSWorkspace.shared.open(page) }
            case .alertThirdButtonReturn: self.defaults.set(version, forKey: "skipVersion")
            default: break
            }
        }
    }

    /// The running app's developer team, from its own code signature. nil for local (ad hoc) builds.
    func teamID(of url: URL) -> String? {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let c = code else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(c, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let d = info as? [String: Any] else { return nil }
        return d[kSecCodeInfoTeamIdentifier as String] as? String
    }
    func validDeveloperID(_ url: URL, team: String) -> Bool {
        var code: SecStaticCode?, req: SecRequirement?
        let text = "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"\(team)\""
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let c = code,
              SecRequirementCreateWithString(text as CFString, [], &req) == errSecSuccess else { return false }
        return SecStaticCodeCheckValidity(c, SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode), req) == errSecSuccess
    }

    func install(dmg: URL, sha: URL?, version: String, page: URL) {
        guard let host = host else { return }
        let appURL = Bundle.main.bundleURL
        guard let team = teamID(of: appURL) else {
            host.alert("This copy of Handover was built on this Mac, so it can't update itself. The download page will open instead.")
            NSWorkspace.shared.open(page); return
        }
        let parent = appURL.deletingLastPathComponent()
        if appURL.path.contains("/AppTranslocation/") || appURL.path.hasPrefix("/Volumes/") || !FileManager.default.isWritableFile(atPath: parent.path) {
            host.alert("Handover can't replace itself where it is now. Drag it into your Applications folder, open it from there, and try again. The download page will open too.")
            NSWorkspace.shared.open(page); return
        }

        let progress = NSAlert()
        progress.messageText = "Downloading Handover \(version)…"
        progress.informativeText = "Handover will relaunch when it's ready."
        let spinner = NSProgressIndicator(frame: NSRect(x: 0, y: 0, width: 240, height: 20))
        spinner.isIndeterminate = true; spinner.style = .bar; spinner.startAnimation(nil)
        progress.accessoryView = spinner
        progress.addButton(withTitle: "Hide")
        progress.beginSheetModal(for: host.window, completionHandler: nil)
        busy = true

        func fail(_ msg: String) {
            DispatchQueue.main.async {
                self.busy = false
                host.window.endSheet(progress.window)
                host.alert(msg + " The download page will open so you can install it yourself.")
                NSWorkspace.shared.open(page)
            }
        }
        URLSession.shared.downloadTask(with: dmg) { tmp, resp, err in
            guard let tmp = tmp, (resp as? HTTPURLResponse)?.statusCode == 200 else { fail("The download failed."); return }
            let fm = FileManager.default
            let work = fm.temporaryDirectory.appendingPathComponent("handover-update-\(UUID().uuidString)", isDirectory: true)
            do {
                try fm.createDirectory(at: work, withIntermediateDirectories: true)
                let file = work.appendingPathComponent("Handover.dmg")
                try fm.moveItem(at: tmp, to: file)
                if let sha = sha {
                    guard let expected = try? String(contentsOf: sha, encoding: .utf8).split(separator: " ").first.map(String.init) else { fail("Couldn't check the download."); return }
                    let actual = SHA256.hash(data: try Data(contentsOf: file)).map { String(format: "%02x", $0) }.joined()
                    guard actual == expected.lowercased() else { fail("The download didn't match its checksum."); return }
                }
                let mount = work.appendingPathComponent("mnt", isDirectory: true)
                guard Updater.run("/usr/bin/hdiutil", ["attach", file.path, "-nobrowse", "-readonly", "-quiet", "-mountpoint", mount.path]) == 0 else { fail("Couldn't open the download."); return }
                let fresh = work.appendingPathComponent("Handover.app")
                let copied = Updater.run("/usr/bin/ditto", [mount.appendingPathComponent("Handover.app").path, fresh.path])
                _ = Updater.run("/usr/bin/hdiutil", ["detach", mount.path, "-quiet", "-force"])
                guard copied == 0 else { fail("The download didn't contain Handover."); return }
                guard self.validDeveloperID(fresh, team: team) else { fail("The new version's signature couldn't be verified, so it wasn't installed."); return }

                // Swap in the new app once this one has quit, then open it.
                let script = """
                while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.2; done
                OLD="$1"; NEW="$2"
                rm -rf "$OLD.previous"
                if mv "$OLD" "$OLD.previous" && /usr/bin/ditto "$NEW" "$OLD"; then rm -rf "$OLD.previous"; else rm -rf "$OLD"; mv "$OLD.previous" "$OLD"; fi
                /usr/bin/open "$OLD"
                rm -rf "$3"
                """
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/sh")
                p.arguments = ["-c", script, "sh", appURL.path, fresh.path, work.path]
                try p.run()
                DispatchQueue.main.async { NSApp.terminate(nil) }
            } catch { fail("The update couldn't be prepared (\(error.localizedDescription)).") }
        }.resume()
    }

    @discardableResult static func run(_ tool: String, _ args: [String]) -> Int32 {
        let p = Process(); p.executableURL = URL(fileURLWithPath: tool); p.arguments = args
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit(); return p.terminationStatus } catch { return -1 }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
