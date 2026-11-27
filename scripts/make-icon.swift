// Draws the Handover app icon. One source of geometry for every output:
//   build/icon/Handover.icns   the app icon
//   site/icon.svg, site/icon.png   the website's logo and favicon
//
// Usage: swift -swift-version 5 scripts/make-icon.swift <repo root>
//
// The design: a checklist card being handed over in front of the previous
// owner's card, on a deep green macOS-style rounded square.

import AppKit

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")

// Geometry on a 1024 canvas, origin top-left (as in SVG).
struct C { let hex: String; var cg: CGColor { let v = Int(hex.dropFirst(), radix: 16)!; return CGColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1) } }
let bgTop = C(hex: "#2f7a57"), bgBottom = C(hex: "#143626")
let backCard = C(hex: "#9fd0b6"), frontCard = C(hex: "#ffffff")
let tickFill = C(hex: "#5b3f8c"), emptyBox = C(hex: "#cfc8de"), bar = C(hex: "#dcd8ce")

let body = CGRect(x: 100, y: 100, width: 824, height: 824), bodyRadius: CGFloat = 186
let card = CGRect(x: 338, y: 226, width: 400, height: 540), cardRadius: CGFloat = 46
let backAngle: CGFloat = -11, backShift = CGPoint(x: -64, y: -6)
let frontAngle: CGFloat = 5
// Rows on the front card: (tick box y, ticked?, bar width)
let rows: [(CGFloat, Bool, CGFloat)] = [(306, true, 196), (436, true, 150), (566, false, 196)]
let boxX: CGFloat = 390, box: CGFloat = 84, boxRadius: CGFloat = 20, barX: CGFloat = 508, barH: CGFloat = 28

func checkPoints(_ x: CGFloat, _ y: CGFloat) -> [CGPoint] {
    [CGPoint(x: x + 20, y: y + 44), CGPoint(x: x + 37, y: y + 61), CGPoint(x: x + 65, y: y + 26)]
}

// MARK: CoreGraphics

func draw(_ ctx: CGContext, size: CGFloat) {
    let s = size / 1024
    ctx.translateBy(x: 0, y: size); ctx.scaleBy(x: s, y: -s) // top-left origin, 1024 units

    // Body with the standard soft shadow
    let bodyPath = CGPath(roundedRect: body, cornerWidth: bodyRadius, cornerHeight: bodyRadius, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10 * s), blur: 22 * s, color: CGColor(gray: 0, alpha: 0.32)) // shadow units are device pixels, y up
    ctx.addPath(bodyPath); ctx.setFillColor(bgBottom.cg); ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addPath(bodyPath); ctx.clip()
    let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [bgTop.cg, bgBottom.cg] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(grad, start: CGPoint(x: 512, y: 100), end: CGPoint(x: 512, y: 924), options: [])

    func rotated(_ deg: CGFloat, shift: CGPoint = .zero, _ f: () -> Void) {
        ctx.saveGState()
        ctx.translateBy(x: card.midX + shift.x, y: card.midY + shift.y)
        ctx.rotate(by: deg * .pi / 180)
        ctx.translateBy(x: -card.midX, y: -card.midY)
        f()
        ctx.restoreGState()
    }
    func rr(_ r: CGRect, _ radius: CGFloat) -> CGPath { CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil) }

    rotated(backAngle, shift: backShift) {
        ctx.addPath(rr(card, cardRadius)); ctx.setFillColor(backCard.cg); ctx.fillPath()
    }
    rotated(frontAngle) {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -14 * s), blur: 30 * s, color: CGColor(gray: 0, alpha: 0.28))
        ctx.addPath(rr(card, cardRadius)); ctx.setFillColor(frontCard.cg); ctx.fillPath()
        ctx.restoreGState()
        for (y, ticked, w) in rows {
            let b = CGRect(x: boxX, y: y, width: box, height: box)
            if ticked {
                ctx.addPath(rr(b, boxRadius)); ctx.setFillColor(tickFill.cg); ctx.fillPath()
                let p = checkPoints(boxX, y)
                ctx.move(to: p[0]); ctx.addLine(to: p[1]); ctx.addLine(to: p[2])
                ctx.setStrokeColor(CGColor(gray: 1, alpha: 1)); ctx.setLineWidth(13); ctx.setLineCap(.round); ctx.setLineJoin(.round); ctx.strokePath()
            } else {
                ctx.addPath(rr(b.insetBy(dx: 6, dy: 6), boxRadius - 4)); ctx.setStrokeColor(emptyBox.cg); ctx.setLineWidth(12); ctx.strokePath()
            }
            ctx.addPath(rr(CGRect(x: barX, y: y + (box - barH) / 2, width: w, height: barH), barH / 2)); ctx.setFillColor(bar.cg); ctx.fillPath()
        }
    }
    ctx.restoreGState()
}

func png(size: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let g = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = g
    draw(g.cgContext, size: CGFloat(size))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

// MARK: SVG (same geometry)

func svg() -> String {
    func n(_ v: CGFloat) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }
    func rect(_ r: CGRect, _ radius: CGFloat, _ attrs: String) -> String {
        "<rect x=\"\(n(r.minX))\" y=\"\(n(r.minY))\" width=\"\(n(r.width))\" height=\"\(n(r.height))\" rx=\"\(n(radius))\" \(attrs)/>"
    }
    let cx = n(card.midX), cy = n(card.midY)
    var front = rect(card, cardRadius, "fill=\"\(frontCard.hex)\" filter=\"url(#cardShadow)\"")
    for (y, ticked, w) in rows {
        let b = CGRect(x: boxX, y: y, width: box, height: box)
        if ticked {
            let p = checkPoints(boxX, y)
            front += rect(b, boxRadius, "fill=\"\(tickFill.hex)\"")
            front += "<path d=\"M\(n(p[0].x)) \(n(p[0].y))L\(n(p[1].x)) \(n(p[1].y))L\(n(p[2].x)) \(n(p[2].y))\" fill=\"none\" stroke=\"#fff\" stroke-width=\"13\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
        } else {
            front += rect(b.insetBy(dx: 6, dy: 6), boxRadius - 4, "fill=\"none\" stroke=\"\(emptyBox.hex)\" stroke-width=\"12\"")
        }
        front += rect(CGRect(x: barX, y: y + (box - barH) / 2, width: w, height: barH), barH / 2, "fill=\"\(bar.hex)\"")
    }
    return """
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <title>Handover</title>
    <defs>
    <linearGradient id="bg" x1="0" y1="100" x2="0" y2="924" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="\(bgTop.hex)"/><stop offset="1" stop-color="\(bgBottom.hex)"/></linearGradient>
    <filter id="bodyShadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="11" flood-opacity=".32"/></filter>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="15" flood-opacity=".28"/></filter>
    <clipPath id="clip">\(rect(body, bodyRadius, ""))</clipPath>
    </defs>
    \(rect(body, bodyRadius, "fill=\"url(#bg)\" filter=\"url(#bodyShadow)\""))
    <g clip-path="url(#clip)">
    <g transform="translate(\(n(backShift.x)) \(n(backShift.y))) rotate(\(n(backAngle)) \(cx) \(cy))">\(rect(card, cardRadius, "fill=\"\(backCard.hex)\""))</g>
    <g transform="rotate(\(n(frontAngle)) \(cx) \(cy))">\(front)</g>
    </g>
    </svg>

    """
}

// MARK: Write everything

let fm = FileManager.default
let iconset = root.appendingPathComponent("build/icon/Handover.iconset")
try? fm.removeItem(at: iconset)
try fm.createDirectory(at: iconset, withIntermediateDirectories: true)
for pt in [16, 32, 128, 256, 512] {
    try png(size: pt).write(to: iconset.appendingPathComponent("icon_\(pt)x\(pt).png"))
    try png(size: pt * 2).write(to: iconset.appendingPathComponent("icon_\(pt)x\(pt)@2x.png"))
}
let icns = root.appendingPathComponent("build/icon/Handover.icns")
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", iconset.path, "-o", icns.path]
try p.run(); p.waitUntilExit()
guard p.terminationStatus == 0 else { fatalError("iconutil failed") }

let site = root.appendingPathComponent("site")
try fm.createDirectory(at: site, withIntermediateDirectories: true)
try svg().write(to: site.appendingPathComponent("icon.svg"), atomically: true, encoding: .utf8)
try png(size: 512).write(to: site.appendingPathComponent("icon.png"))
try png(size: 1024).write(to: root.appendingPathComponent("build/icon/preview-1024.png"))
print("Wrote \(icns.path), site/icon.svg, site/icon.png")
