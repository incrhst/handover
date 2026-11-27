#!/bin/bash
# Packages build/Handover.app as dist/Handover.dmg, with an Applications shortcut.
# With SIGN_IDENTITY and notarisation credentials set (see notarize.sh), the app
# and the DMG are both notarised and stapled, so they open on any Mac with no warning.
#
#   scripts/build-dmg.sh
set -euo pipefail
cd "$(dirname "$0")/.."
APP=build/Handover.app
[ -d "$APP" ] || { echo "Run scripts/build-app.sh first"; exit 1; }
NOTARISE=""
if [ -n "${SIGN_IDENTITY:-}" ] && { [ -n "${NOTARY_PROFILE:-}" ] || [ -n "${NOTARY_KEY_PATH:-}" ]; }; then NOTARISE=1; fi

if [ -n "$NOTARISE" ]; then
  ditto -c -k --keepParent "$APP" build/Handover-notarize.zip
  scripts/notarize.sh build/Handover-notarize.zip
  xcrun stapler staple "$APP"
  rm build/Handover-notarize.zip
fi

rm -rf build/dmg dist/Handover.dmg && mkdir -p build/dmg dist
cp -R "$APP" build/dmg/
ln -s /Applications build/dmg/Applications
hdiutil create -volname Handover -srcfolder build/dmg -ov -format UDZO -fs HFS+ dist/Handover.dmg >/dev/null
rm -rf build/dmg

if [ -n "${SIGN_IDENTITY:-}" ]; then codesign --force --timestamp --sign "$SIGN_IDENTITY" dist/Handover.dmg; fi
if [ -n "$NOTARISE" ]; then
  scripts/notarize.sh dist/Handover.dmg
  xcrun stapler staple dist/Handover.dmg
  spctl --assess --type open --context context:primary-signature -v dist/Handover.dmg
fi
hdiutil verify dist/Handover.dmg >/dev/null
shasum -a 256 dist/Handover.dmg | tee dist/Handover.dmg.sha256
echo "Built dist/Handover.dmg"
