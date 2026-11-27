#!/bin/bash
# Builds build/Handover.app (universal: Apple silicon and Intel, macOS 13+).
#
#   scripts/build-app.sh [version]
#
# Optional environment:
#   SIGN_IDENTITY   "Developer ID Application: Your Name (TEAMID)". Without it the
#                   app is signed ad hoc, which runs on this Mac but not on others.
#   BUNDLE_ID       default com.incrementic.handover
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || true)}"
VERSION="${VERSION:-0.1.0}"
BUILD="$(git rev-list --count HEAD 2>/dev/null || echo 1)"
BUNDLE_ID="${BUNDLE_ID:-com.incrementic.handover}"
APP=build/Handover.app

echo "Building Handover $VERSION ($BUILD)"
rm -rf "$APP" build/bin && mkdir -p build/bin "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

for arch in arm64 x86_64; do
  swiftc -swift-version 5 -O -target "$arch-apple-macos13.0" -o "build/bin/Handover-$arch" app/macos/main.swift
done
lipo -create -output "$APP/Contents/MacOS/Handover" build/bin/Handover-arm64 build/bin/Handover-x86_64

[ -f build/icon/Handover.icns ] || swift -swift-version 5 scripts/make-icon.swift .
cp build/icon/Handover.icns "$APP/Contents/Resources/Handover.icns"
cp app/web/index.html app/web/core.js "$APP/Contents/Resources/web/"
cp site/examples/sample.handover "$APP/Contents/Resources/web/sample.handover"
cp site/prompt.md "$APP/Contents/Resources/web/prompt.md"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" -e "s/__BUNDLE_ID__/$BUNDLE_ID/" app/macos/Info.plist > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null

if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
else
  echo "SIGN_IDENTITY not set: signing ad hoc (fine for this Mac, not for sharing)"
  codesign --force --sign - "$APP"
fi
codesign --verify --strict "$APP"
echo "Built $APP"
