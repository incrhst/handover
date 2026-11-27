#!/bin/bash
# Copies the shared pieces into the agent skill, which must stand alone once installed.
#   scripts/sync-shared.sh          copy
#   scripts/sync-shared.sh --check  fail if anything is out of date (used in CI)
set -euo pipefail
cd "$(dirname "$0")/.."
PAIRS=(
  "app/web/core.js:skills/handover/scripts/core.js"
  "spec/SPEC.md:skills/handover/references/SPEC.md"
  "site/schema/v1.json:skills/handover/references/schema.json"
  "site/examples/sample.handover:skills/handover/references/sample.handover"
  "site/examples/ea-no-overlap.handover:skills/handover/references/ea-no-overlap.handover"
  "site/prompt.md:skills/handover/references/interview-prompt.md"
)
status=0
for p in "${PAIRS[@]}"; do
  src="${p%%:*}"; dst="${p##*:}"
  if [ "${1:-}" = "--check" ]; then
    cmp -s "$src" "$dst" || { echo "Out of date: $dst (run scripts/sync-shared.sh)"; status=1; }
  else
    mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"
  fi
done
exit $status
