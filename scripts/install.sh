#!/usr/bin/env bash
# Installs owlaso + owlaso-mcp under ~/mcp-connectors and registers the server with Claude.
set -euo pipefail

ROOT="${MCP_CONNECTORS_DIR:-$HOME/mcp-connectors}"
mkdir -p "$ROOT"

sync() { # repo dir
  if [ -d "$ROOT/$2/.git" ]; then git -C "$ROOT/$2" pull --ff-only; else git clone "https://github.com/$1.git" "$ROOT/$2"; fi
}
sync alpernae/owlaso-mcp owlaso-mcp
sync owlaso/owlaso owlaso
(cd "$ROOT/owlaso-mcp" && npm ci)
(cd "$ROOT/owlaso" && npm ci --ignore-scripts)

ENTRY="$ROOT/owlaso-mcp/src/index.js"
export OWLASO_DIR="$ROOT/owlaso"

# Claude Code
if command -v claude >/dev/null; then
  claude mcp remove owlaso -s user >/dev/null 2>&1 || true
  claude mcp add owlaso -s user -e "OWLASO_DIR=$OWLASO_DIR" -- node "$ENTRY"
fi

# Claude Desktop (merge into claude_desktop_config.json)
case "$(uname -s)" in
  Darwin) CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
  MINGW*|MSYS*|CYGWIN*) CFG="${APPDATA:-$HOME/AppData/Roaming}/Claude/claude_desktop_config.json" ;;
  *) CFG="${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json" ;;
esac
mkdir -p "$(dirname "$CFG")"
CFG="$CFG" ENTRY="$ENTRY" node -e '
const fs=require("fs");const p=process.env.CFG;
let c={};try{c=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
(c.mcpServers??={}).owlaso={command:process.execPath,args:[process.env.ENTRY],env:{OWLASO_DIR:process.env.OWLASO_DIR}};
fs.writeFileSync(p,JSON.stringify(c,null,2));console.log("Claude Desktop config updated:",p)'
echo "Done. Restart Claude Desktop."
