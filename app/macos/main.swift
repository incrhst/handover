// Handover for macOS: a window around app/web/index.html, plus the parts a web
// page can't do reliably on its own: real files on disk, a clock that keeps
// running, the daily task sheet, reminders as notifications, nightly backups and opening at login.
//
// Data folder (default ~/Documents/Handover, or $HANDOVER_DATA):
//   handovers/<id>.handover   the content of each handover, as loaded
//   progress/<id>.<reader>.json  each person's ticks, notes and first-seen date
//   daily/<id>-<date>.md      the task sheet, written each morning
//   backups/<date>/           a copy of handovers/ and progress/, last 30 days
//   backups/conflicts/        extra copies a cloud folder kept, once merged in
//
// The folder can be shared (iCloud Drive, Google Drive, Dropbox) between the people
// working on a handover. Content saves only replace what the page last read; if the
// file changed meanwhile, the page merges the two (core.js mergeHandover). Progress
// is per person, so nobody's ticks are overwritten.

import AppKit
import CryptoKit
import ServiceManagement
import UniformTypeIdentifiers
import UserNotifications
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
    /// Whose progress this Mac keeps: the account's short name, so two people sharing a folder keep their own ticks.
    var reader: String {
        if let r = defaults.string(forKey: "reader"), validID(r) { return r }
        let raw = NSUserName().lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        let r = validID(raw) ? raw : "me"
        defaults.set(r, forKey: "reader")
        return r
    }
    func sourceURL(_ id: String) -> URL { dir("handovers").appendingPathComponent("\(id).handover") }
    func stateURL(_ id: String) -> URL { dir("progress").appendingPathComponent("\(id).\(reader).json") }
    /// Reads and writes go through NSFileCoordinator, so iCloud Drive never hands over a half-synced file.
    func read(_ url: URL) -> Data? {
        var out: Data?, err: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &err) { u in out = try? Data(contentsOf: u) }
        return out
    }
    func source(_ id: String) -> String? {
        guard validID(id), let d = read(sourceURL(id)) else { return nil }
        return String(decoding: d, as: UTF8.self)
    }
    func state(_ id: String) -> Any? {
        guard validID(id) else { return nil }
        let fm = FileManager.default, mine = stateURL(id), legacy = dir("progress").appendingPathComponent("\(id).json")
        // Progress saved before it was kept per person becomes this person's.
        if !fm.fileExists(atPath: mine.path) && fm.fileExists(atPath: legacy.path) { try? fm.moveItem(at: legacy, to: mine) }
        guard let d = read(mine) else { return nil }
        return try? JSONSerialization.jsonObject(with: d)
    }
    /// Write a handover. Given base (the text the page last read), it writes only if the file still holds
    /// base; otherwise it writes nothing and returns what the file holds now, for the page to merge.
    func writeSource(_ id: String, _ text: String, base: String? = nil) throws -> String? {
        guard validID(id) else { throw CocoaError(.fileWriteInvalidFileName) }
        var current: String?, failure: Error?, err: NSError?
        NSFileCoordinator().coordinate(writingItemAt: sourceURL(id), options: .forMerging, error: &err) { u in
            if let base = base, let d = try? Data(contentsOf: u) {
                let now = String(decoding: d, as: UTF8.self)
                if now != base { current = now; return }
            }
            do { try Data(text.utf8).write(to: u, options: .atomic) } catch { failure = error }
        }
        if let e = err ?? failure { throw e }
        return current
    }
    func writeState(_ id: String, _ state: Any) throws {
        guard validID(id) else { throw CocoaError(.fileWriteInvalidFileName) }
        let d = try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
        try d.write(to: stateURL(id), options: .atomic)
    }
    /// How many people keep progress on this handover here: more than one means the folder is shared.
    func readers(_ id: String) -> Int {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir("progress").path)) ?? []).filter { n in
            n.hasPrefix(id + ".") && n.hasSuffix(".json") && !n.dropFirst(id.count + 1).dropLast(5).contains(".")
        }.count
    }

    // MARK: Copies a cloud folder kept side by side (it couldn't tell which of two saves should win)

    func versionToken(_ v: NSFileVersion) -> String { "icloud:\(v.modificationDate?.timeIntervalSince1970 ?? 0):\(v.localizedNameOfSavingComputer ?? "")" }
    /// iCloud's conflict versions, and files like "role (David's conflicted copy).handover" or "role 2.handover"
    /// whose content is the same handover. Each comes with a token for resolveConflicts.
    func conflictCopies(_ id: String, withText: Bool = true) -> [(token: String, text: String)] {
        guard validID(id) else { return [] }
        var out: [(token: String, text: String)] = []
        for v in NSFileVersion.unresolvedConflictVersionsOfItem(at: sourceURL(id)) ?? [] {
            let text = withText ? (try? Data(contentsOf: v.url)).map { String(decoding: $0, as: UTF8.self) } : ""
            if let t = text { out.append((versionToken(v), t)) }
        }
        let files = (try? FileManager.default.contentsOfDirectory(at: dir("handovers"), includingPropertiesForKeys: nil)) ?? []
        for f in files where f.pathExtension == "handover" {
            let stem = f.deletingPathExtension().lastPathComponent
            guard stem != id, stem.hasPrefix(id), !validID(stem), let d = read(f),
                  let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], o["id"] as? String == id else { continue }
            out.append(("file:" + f.lastPathComponent, withText ? String(decoding: d, as: UTF8.self) : ""))
        }
        return out
    }
    /// After the page merged them in: mark iCloud's versions resolved, and move extra files to backups/conflicts.
    func resolveConflicts(_ id: String, _ tokens: [String]) {
        guard validID(id) else { return }
        let url = sourceURL(id), want = Set(tokens)
        var err: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forMerging, error: &err) { u in
            let open = NSFileVersion.unresolvedConflictVersionsOfItem(at: u) ?? []
            for v in open where want.contains(versionToken(v)) { v.isResolved = true }
            if !open.isEmpty && open.allSatisfy({ $0.isResolved }) { try? NSFileVersion.removeOtherVersionsOfItem(at: u) }
        }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd-HHmmss"; f.locale = Locale(identifier: "en_US_POSIX")
        let into = dir("backups").appendingPathComponent("conflicts", isDirectory: true)
        try? FileManager.default.createDirectory(at: into, withIntermediateDirectories: true)
        for t in tokens where t.hasPrefix("file:") {
            let name = String(t.dropFirst(5))
            guard !name.contains("/"), name.hasSuffix(".handover") else { continue }
            try? FileManager.default.moveItem(at: dir("handovers").appendingPathComponent(name), to: into.appendingPathComponent(f.string(from: Date()) + "-" + name))
        }
    }

    func library() -> [[String: String]] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir("handovers"), includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "handover" }.compactMap { u in
            let id = u.deletingPathExtension().lastPathComponent
            guard validID(id), let d = try? Data(contentsOf: u), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
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
    let reminders = Reminders()
    var window: NSWindow!
    var web: WKWebView!
    var ready = false
    var pendingOpens: [URL] = []
    var timer: Timer?
    var syncTimer: Timer?
    var seen: [String: Date] = [:]
    var offered: Set<String> = []
    var polls = 0
    var titleObs: NSKeyValueObservation?

    var webDir: URL { Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true) }

    // Set before launch finishes, so a click on a reminder that opened the app isn't missed.
    func applicationWillFinishLaunching(_ n: Notification) { reminders.host = self; reminders.setUp() }

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
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.updater.reportLastUpdate() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.updater.checkIfDue() }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.tick() }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.tick() }
        syncTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.pollShared() }
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.pollShared(scan: true) }
    }

    /// Every few seconds: did the open handover change on disk (saved on another Mac, in a shared folder)?
    /// The page fetches the new copy and ignores it if it's what it last saved. Every 30 seconds, also
    /// look for extra copies a cloud folder kept side by side.
    func pollShared(scan: Bool = false) {
        guard ready, let id = store.last, validID(id) else { return }
        let url = store.sourceURL(id)
        if let m = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, m != seen[id] {
            seen[id] = m
            callJS("handoverChanged", [id])
        }
        polls += 1
        guard scan || polls % 10 == 0 else { return }
        let fresh = Set(store.conflictCopies(id, withText: false).map { $0.token }).subtracting(offered)
        if !fresh.isEmpty { offered.formUnion(fresh); callJS("handoverConflicts", [id]) }
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
        reminders.flush()
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
            var r: [String: Any] = ["library": store.library(), "dataFolder": store.root.path, "loginItem": SMAppService.mainApp.status == .enabled, "version": updater.current, "autoUpdate": updater.auto, "reminders": reminders.prefs]
            if let id = store.last, let src = store.source(id) { r["source"] = src; r["state"] = store.state(id) ?? NSNull() }
            reply(r)
        case "adopt":
            // With base, a save that would overwrite someone else's change comes back as {current} instead.
            let id = str("id"), base = payload["force"] as? Bool == true ? nil : payload["base"] as? String
            do {
                if let current = try store.writeSource(id, str("text"), base: base) { reply(["current": current]); return }
                store.last = id; reply(["state": store.state(id) ?? NSNull()])
            }
            catch { alert("Couldn't save the handover: \(error.localizedDescription)"); reply(nil) }
        case "current":
            reply(["text": (store.source(str("id")) as Any?) ?? NSNull()])
        case "conflictCopies":
            reply(["copies": store.conflictCopies(str("id")).map { ["token": $0.token, "text": $0.text] }])
        case "conflictsDone":
            store.resolveConflicts(str("id"), payload["tokens"] as? [String] ?? []); reply(["ok": true])
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
            let ext = (str("filename") as NSString).pathExtension.lowercased()
            p.allowedContentTypes = [ext.isEmpty || ext == "handover" ? handoverType : (UTType(filenameExtension: ext) ?? .data)]; p.isExtensionHidden = false
            p.beginSheetModal(for: window) { r in
                guard r == .OK, let u = p.url else { reply(nil); return }
                let b64 = self.str(payload, "base64")
                let data = b64.isEmpty ? Data(self.str(payload, "content").utf8) : (Data(base64Encoded: b64) ?? Data())
                do { try data.write(to: u, options: .atomic); reply(["path": u.path]) }
                catch { self.alert("Couldn't save: \(error.localizedDescription)"); reply(nil) }
            }
        case "exportSheet":
            var name = (str("filename") as NSString).lastPathComponent
            // In a shared folder each person's morning sheet gets their own name.
            if payload["auto"] as? Bool == true, store.readers(str("id")) > 1 { name = (name as NSString).deletingPathExtension + "-" + store.reader + ".md" }
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
        case "reminders":
            // Everything to remind about from now on, worked out by the page (core.js reminders). It replaces what was scheduled.
            let items = payload["items"] as? [[String: Any]] ?? []
            reminders.schedule(handover: str("handover"), items: items, ticked: payload["ticked"] as? [String] ?? []) { status in reply(["status": status]) }
        case "setReminderPrefs":
            reminders.prefs = ["morning": payload["morning"] as? Bool ?? true, "jobs": payload["jobs"] as? Bool ?? true]; reply(["ok": true])
        case "notificationSettings":
            reminders.openSettings(); reply(["ok": true])
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

// MARK: Reminders
// The page works out what to remind about and when; this posts them as notifications, at the right time
// even while the window is closed or the app isn't running. A job's reminder has Done, which ticks it off,
// and Remind Me in an Hour.

final class Reminders: NSObject, UNUserNotificationCenterDelegate {
    weak var host: AppDelegate?
    let center = UNUserNotificationCenter.current()
    let defaults = UserDefaults.standard
    let prefix = "handover.", snoozed = "snooze."
    /// Clicks that came in before the page was ready (a click can open the app)
    var queued: [[Any]] = []

    var prefs: [String: Bool] {
        get { defaults.dictionary(forKey: "reminders") as? [String: Bool] ?? ["morning": true, "jobs": true] }
        set { defaults.set(newValue, forKey: "reminders") }
    }

    func setUp() {
        center.delegate = self
        let done = UNNotificationAction(identifier: "done", title: "Done", options: [])
        let later = UNNotificationAction(identifier: "later", title: "Remind Me in an Hour", options: [])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "job", actions: [done, later], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "summary", actions: [], intentIdentifiers: [], options: []),
        ])
    }

    static func statusName(_ s: UNAuthorizationStatus) -> String {
        switch s { case .notDetermined: return "notDetermined"; case .denied: return "denied"; default: return "authorized" }
    }

    /// A job's reminder put off with Remind Me in an Hour. One per job occurrence, so it can be dropped once the job is ticked.
    func snoozeID(_ handover: String, _ key: String) -> String { snoozed + handover + "." + key }

    /// Replace the scheduled reminders with these, and drop any put off for later whose job is now ticked.
    /// The first time there is something to schedule, macOS asks whether Handover may send notifications.
    /// Replies with "authorized", "denied" or "notDetermined".
    func schedule(handover: String, items: [[String: Any]], ticked: [String], done: @escaping (String) -> Void) {
        if validID(handover) && !ticked.isEmpty { center.removePendingNotificationRequests(withIdentifiers: ticked.map { snoozeID(handover, $0) }) }
        let iso = ISO8601DateFormatter()
        let now = Date()
        let requests: [UNNotificationRequest] = items.compactMap { it in
            guard let id = it["id"] as? String, let atText = it["at"] as? String, let at = iso.date(from: atText), at > now else { return nil }
            let c = UNMutableNotificationContent()
            c.title = it["title"] as? String ?? "Handover"
            c.subtitle = it["subtitle"] as? String ?? ""
            c.body = it["body"] as? String ?? ""
            c.sound = .default
            let kind = it["kind"] as? String ?? "summary"
            c.categoryIdentifier = kind == "job" ? "job" : "summary"
            c.threadIdentifier = handover
            c.userInfo = ["handover": handover, "key": it["key"] as? String ?? "", "kind": kind]
            let when = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: at)
            return UNNotificationRequest(identifier: prefix + handover + "." + id, content: c, trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: false))
        }
        center.getNotificationSettings { settings in
            let go = { (status: UNAuthorizationStatus) in
                self.center.getPendingNotificationRequests { pending in
                    // Reminders put off for later stay, unless their job was ticked (above): the person asked for them.
                    let stale = pending.map { $0.identifier }.filter { $0.hasPrefix(self.prefix) }
                    self.center.removePendingNotificationRequests(withIdentifiers: stale)
                    if status != .denied { requests.forEach { r in self.center.add(r) { e in if let e = e { NSLog("Handover: couldn't schedule a reminder: \(e)") } } } }
                    DispatchQueue.main.async { done(Reminders.statusName(status)) }
                }
            }
            if settings.authorizationStatus == .notDetermined && !requests.isEmpty {
                self.center.requestAuthorization(options: [.alert, .sound]) { ok, _ in go(ok ? .authorized : .denied) }
            } else { go(settings.authorizationStatus) }
        }
    }

    func openSettings() {
        let id = Bundle.main.bundleIdentifier ?? ""
        let deep = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)")!
        if !NSWorkspace.shared.open(deep) { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.notifications")!) }
    }

    /// Show reminders even while Handover is the app in front.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        let content = response.notification.request.content, info = content.userInfo
        let handover = info["handover"] as? String ?? "", key = info["key"] as? String ?? ""
        DispatchQueue.main.async {
            switch response.actionIdentifier {
            case "done":
                self.send(["done", handover, key])
            case "later":
                let again = content.mutableCopy() as! UNMutableNotificationContent
                let id = validID(handover) && !key.isEmpty ? self.snoozeID(handover, key) : self.snoozed + UUID().uuidString
                let r = UNNotificationRequest(identifier: id, content: again, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 3600, repeats: false))
                self.center.add(r, withCompletionHandler: nil)
            case UNNotificationDismissActionIdentifier: break
            default:
                self.host?.showWindow()
                self.send(["open", handover, key])
            }
            done()
        }
    }

    func send(_ args: [Any]) {
        guard let host = host, host.ready else { queued.append(args); return }
        host.callJS("handoverReminder", args)
    }
    func flush() { let q = queued; queued = []; q.forEach(send) }
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
        a.informativeText = "You have \(current)."
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { a.accessoryView = notesView(trimmed) }
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

    /// Release notes are Markdown: bullets, **bold**, *italic*, `code` and links. Shown formatted, in a scrolling box.
    func notesView(_ md: String) -> NSView {
        let size = NSFont.smallSystemFontSize, base = NSFont.systemFont(ofSize: size)
        let out = NSMutableAttributedString()
        let lines = md.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        for (i, raw) in lines.enumerated() {
            var line = raw.trimmingCharacters(in: .whitespaces)
            let para = NSMutableParagraphStyle(); para.paragraphSpacing = 8
            var prefix = ""
            if let r = line.range(of: #"^([-*+]|\d+[.)])\s+"#, options: .regularExpression) {
                let marker = line[r].trimmingCharacters(in: .whitespaces)
                prefix = (marker.first?.isNumber == true ? marker : "•") + "\t"
                line = String(line[r.upperBound...])
                para.headIndent = 14; para.tabStops = [NSTextTab(textAlignment: .left, location: 14)]
            } else if let r = line.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
                line = "**" + line[r.upperBound...] + "**"
            }
            let piece = NSMutableAttributedString(string: prefix, attributes: [.font: base])
            let parsed = (try? AttributedString(markdown: line, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(line)
            for run in parsed.runs {
                let text = String(parsed[run.range].characters)
                var font = base
                if let intent = run.inlinePresentationIntent {
                    if intent.contains(.code) { font = .monospacedSystemFont(ofSize: size, weight: .regular) }
                    var traits: NSFontDescriptor.SymbolicTraits = []
                    if intent.contains(.stronglyEmphasized) { traits.insert(.bold) }
                    if intent.contains(.emphasized) { traits.insert(.italic) }
                    if !traits.isEmpty { font = NSFont(descriptor: font.fontDescriptor.withSymbolicTraits(traits), size: size) ?? font }
                }
                var attrs: [NSAttributedString.Key: Any] = [.font: font]
                if let link = run.link { attrs[.link] = link }
                piece.append(NSAttributedString(string: text, attributes: attrs))
            }
            if i < lines.count - 1 { piece.append(NSAttributedString(string: "\n", attributes: [.font: base])) }
            piece.addAttributes([.paragraphStyle: para, .foregroundColor: NSColor.labelColor], range: NSRange(location: 0, length: piece.length))
            piece.enumerateAttribute(.link, in: NSRange(location: 0, length: piece.length)) { v, r, _ in if v != nil { piece.addAttribute(.foregroundColor, value: NSColor.linkColor, range: r) } }
            out.append(piece)
        }
        let width: CGFloat = 340
        let text = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: 10))
        text.isEditable = false; text.isSelectable = true; text.drawsBackground = false
        text.textContainerInset = NSSize(width: 0, height: 2); text.textContainer?.lineFragmentPadding = 0
        text.textStorage?.setAttributedString(out)
        text.layoutManager?.ensureLayout(for: text.textContainer!)
        let needed = ceil((text.layoutManager?.usedRect(for: text.textContainer!).height ?? 100) + 6)
        text.frame.size.height = needed; text.isVerticallyResizable = true; text.autoresizingMask = [.width]
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: width, height: min(needed, 240)))
        scroll.hasVerticalScroller = needed > 240; scroll.drawsBackground = false; scroll.borderType = .noBorder
        scroll.documentView = text
        return scroll
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

        // A sheet with a real progress bar and a line saying which step it's on. Cancel works until the swap starts.
        let progress = NSAlert()
        progress.messageText = "Updating to Handover \(version)"
        progress.informativeText = "Handover will quit and reopen by itself when the new version is ready."
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 44))
        let status = NSTextField(labelWithString: "Connecting…")
        status.frame = NSRect(x: 0, y: 24, width: 300, height: 18); status.font = .systemFont(ofSize: NSFont.smallSystemFontSize); status.textColor = .secondaryLabelColor
        let bar = NSProgressIndicator(frame: NSRect(x: 0, y: 2, width: 300, height: 16))
        bar.style = .bar; bar.isIndeterminate = false; bar.minValue = 0; bar.maxValue = 1; bar.doubleValue = 0
        box.addSubview(status); box.addSubview(bar)
        progress.accessoryView = box
        let cancel = progress.addButton(withTitle: "Cancel")
        busy = true
        var cancelled = false, finished = false, poll: Timer?
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30   // no data for 30 seconds counts as a failure
        config.timeoutIntervalForResource = 600
        let session = URLSession(configuration: config)
        var task: URLSessionDownloadTask?

        func step(_ text: String, _ value: Double? = nil) {
            DispatchQueue.main.async {
                status.stringValue = text
                if let v = value { bar.isIndeterminate = false; bar.doubleValue = v } else { bar.isIndeterminate = true; bar.startAnimation(nil) }
            }
        }
        func closeSheet() { poll?.invalidate(); if progress.window.sheetParent != nil { host.window.endSheet(progress.window) } }
        func fail(_ msg: String) {
            DispatchQueue.main.async {
                guard !finished else { return }
                finished = true; self.busy = false; session.invalidateAndCancel()
                closeSheet()
                if cancelled { return }
                let a = NSAlert()
                a.alertStyle = .warning
                a.messageText = "Handover \(version) wasn't installed"
                a.informativeText = msg + " You still have Handover \(self.current), and nothing has changed."
                a.addButton(withTitle: "Try Again"); a.addButton(withTitle: "Open Download Page"); a.addButton(withTitle: "Close")
                a.beginSheetModal(for: host.window) { r in
                    if r == .alertFirstButtonReturn { self.install(dmg: dmg, sha: sha, version: version, page: page) }
                    else if r == .alertSecondButtonReturn { NSWorkspace.shared.open(page) }
                }
            }
        }
        progress.beginSheetModal(for: host.window) { r in
            guard !finished else { return }
            cancelled = true; task?.cancel(); fail("")
        }

        task = session.downloadTask(with: dmg) { tmp, resp, err in
            if cancelled { return }
            if let err = err as NSError? {
                fail(err.code == NSURLErrorTimedOut ? "The download stalled." : err.code == NSURLErrorNotConnectedToInternet ? "This Mac isn't connected to the internet." : "The download failed (\(err.localizedDescription))."); return
            }
            guard let tmp = tmp, (resp as? HTTPURLResponse)?.statusCode == 200 else { fail("The download failed (the server answered \((resp as? HTTPURLResponse)?.statusCode ?? 0))."); return }
            DispatchQueue.main.async { poll?.invalidate(); cancel.isEnabled = false }
            let fm = FileManager.default
            let work = fm.temporaryDirectory.appendingPathComponent("handover-update-\(UUID().uuidString)", isDirectory: true)
            do {
                try fm.createDirectory(at: work, withIntermediateDirectories: true)
                let file = work.appendingPathComponent("Handover.dmg")
                try fm.moveItem(at: tmp, to: file)
                step("Checking the download…")
                if let sha = sha {
                    guard let expected = try? String(contentsOf: sha, encoding: .utf8).split(separator: " ").first.map(String.init) else { fail("Its checksum couldn't be downloaded."); return }
                    let actual = SHA256.hash(data: try Data(contentsOf: file)).map { String(format: "%02x", $0) }.joined()
                    guard actual == expected.lowercased() else { fail("The download was damaged: it didn't match its checksum."); return }
                }
                step("Opening the new version…")
                let mount = work.appendingPathComponent("mnt", isDirectory: true)
                guard Updater.run("/usr/bin/hdiutil", ["attach", file.path, "-nobrowse", "-readonly", "-quiet", "-mountpoint", mount.path]) == 0 else { fail("The downloaded disk image couldn't be opened."); return }
                let fresh = work.appendingPathComponent("Handover.app")
                let copied = Updater.run("/usr/bin/ditto", [mount.appendingPathComponent("Handover.app").path, fresh.path])
                _ = Updater.run("/usr/bin/hdiutil", ["detach", mount.path, "-quiet", "-force"])
                guard copied == 0 else { fail("The download didn't contain Handover."); return }
                step("Checking Apple's signature…")
                guard self.validDeveloperID(fresh, team: team) else { fail("The new version's signature couldn't be verified."); return }

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
                step("Restarting Handover…", 1)
                DispatchQueue.main.async {
                    finished = true
                    // After relaunch, say whether it worked (see reportLastUpdate).
                    self.defaults.set(version, forKey: "updatingTo"); self.defaults.set(self.current, forKey: "updatingFrom"); self.defaults.synchronize()
                    closeSheet()   // an open sheet can stop the app from quitting
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                        NSApp.terminate(nil)
                        // If something still holds the app open, quit anyway: the new version is waiting.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { exit(0) }
                    }
                }
            } catch { fail("The update couldn't be prepared (\(error.localizedDescription)).") }
        }
        poll = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { _ in
            guard let t = task else { return }
            let got = t.countOfBytesReceived, total = t.countOfBytesExpectedToReceive
            let f = ByteCountFormatter(); f.countStyle = .file
            if total > 0 { status.stringValue = "Downloading… \(f.string(fromByteCount: got)) of \(f.string(fromByteCount: total))"; bar.doubleValue = Double(got) / Double(total) * 0.85 }
            else if got > 0 { status.stringValue = "Downloading… \(f.string(fromByteCount: got))" }
        }
        task?.resume()
    }

    /// After an update relaunch: say plainly whether the new version is running.
    func reportLastUpdate() {
        guard let to = defaults.string(forKey: "updatingTo"), let host = host else { return }
        let from = defaults.string(forKey: "updatingFrom") ?? ""
        defaults.removeObject(forKey: "updatingTo"); defaults.removeObject(forKey: "updatingFrom")
        let a = NSAlert()
        if current == to {
            a.messageText = "Handover is up to date"
            a.informativeText = "You now have Handover \(to)" + (from.isEmpty ? "." : ", updated from \(from).")
            a.addButton(withTitle: "OK")
        } else {
            a.alertStyle = .warning
            a.messageText = "The update to Handover \(to) didn't finish"
            a.informativeText = "You still have Handover \(current). Try again, or download it and drag it into Applications yourself."
            a.addButton(withTitle: "Check Again"); a.addButton(withTitle: "Open Download Page"); a.addButton(withTitle: "Close")
        }
        a.beginSheetModal(for: host.window) { r in
            guard self.current != to else { return }
            if r == .alertFirstButtonReturn { self.check(userInitiated: true) } else if r == .alertSecondButtonReturn { NSWorkspace.shared.open(self.releasePage) }
        }
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
