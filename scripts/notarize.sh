#!/bin/bash
# Notarises a .zip or .dmg with Apple and staples the ticket (the DMG; for the
# app, zip it first and staple the .app afterwards).
#
#   scripts/notarize.sh <file>
#
# Credentials, one of:
#   NOTARY_PROFILE   a keychain profile saved with:
#                    xcrun notarytool store-credentials handover --apple-id you@example.com --team-id TEAMID
#   NOTARY_KEY_PATH + NOTARY_KEY_ID + NOTARY_ISSUER   an App Store Connect API key (used in CI)
set -euo pipefail
FILE="$1"
if [ -n "${NOTARY_PROFILE:-}" ]; then
  AUTH=(--keychain-profile "$NOTARY_PROFILE")
elif [ -n "${NOTARY_KEY_PATH:-}" ]; then
  AUTH=(--key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
else
  echo "No notarisation credentials (NOTARY_PROFILE or NOTARY_KEY_PATH): skipping" >&2
  exit 0
fi
echo "Notarising $FILE (this usually takes a few minutes)"
xcrun notarytool submit "$FILE" "${AUTH[@]}" --wait
