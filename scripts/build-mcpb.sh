#!/bin/bash
# Builds dist/Handover.mcpb: the MCP server as a Claude Desktop extension (double-click to install).
#
#   scripts/build-mcpb.sh [version]
#
# The bundle holds app/mcp/manifest.json (with the version and the tool list filled in), the server
# and core.js from the skill, and the icon. Claude Desktop runs it with its own Node.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || true)}"
VERSION="${VERSION:-0.1.0}"
OUT=build/mcpb
rm -rf "$OUT" && mkdir -p "$OUT/server" dist

cp skills/handover/scripts/core.js "$OUT/server/core.js"
sed "s/^const VERSION = \".*\";/const VERSION = \"$VERSION\";/" skills/handover/scripts/mcp-server.cjs > "$OUT/server/mcp-server.cjs"
cp site/icon.png "$OUT/icon.png"
cp LICENSE "$OUT/LICENSE"

# The tool list comes from the bundled server itself, asked over stdio, so the manifest can't fall behind it
VERSION="$VERSION" node -e '
  const fs = require("fs");
  const { execFileSync } = require("child_process");
  const ask = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n";
  const out = execFileSync(process.execPath, [process.argv[1] + "/server/mcp-server.cjs"], { input: ask, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], env: Object.assign({}, process.env, { HANDOVER_BUNDLE_ID: "none" }) });
  const { tools } = JSON.parse(out.trim().split("\n")[0]).result;
  const m = JSON.parse(fs.readFileSync("app/mcp/manifest.json", "utf8"));
  m.version = process.env.VERSION;
  m.tools = tools.map(t => ({ name: t.name, description: t.description.split(/(?<=\.) /)[0] }));
  fs.writeFileSync(process.argv[1] + "/manifest.json", JSON.stringify(m, null, 2) + "\n");
' "$OUT"
grep -q "^const VERSION = \"$VERSION\";" "$OUT/server/mcp-server.cjs" || { echo "Couldn't stamp the version into the server"; exit 1; }

rm -f dist/Handover.mcpb
(cd "$OUT" && zip -qrX ../../dist/Handover.mcpb manifest.json icon.png LICENSE server)
(cd dist && shasum -a 256 Handover.mcpb) | tee dist/Handover.mcpb.sha256
echo "Built dist/Handover.mcpb ($VERSION)"
