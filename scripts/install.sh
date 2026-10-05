#!/usr/bin/env bash
# Installs owlaso + owlaso-mcp under ~/mcp-connectors and registers the server with Claude.
set -euo pipefail

ROOT="${MCP_CONNECTORS_DIR:-$HOME/mcp-connectors}"
mkdir -p "$ROOT"

sync_repo() { # owner/repo dir
  if [ -d "$ROOT/$2/.git" ]; then git -C "$ROOT/$2" pull --ff-only; else git clone "https://github.com/$1.git" "$ROOT/$2"; fi
}
sync_repo owlaso/owlaso-mcp owlaso-mcp
sync_repo owlaso/owlaso owlaso
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
# Never clobber an existing config we can't parse (other servers would be lost); back it up and write atomically.
CFG="$CFG" ENTRY="$ENTRY" node -e '
const fs=require("fs");const p=process.env.CFG;
let c={};
try{c=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){
  if(e.code!=="ENOENT"){console.error("Refusing to modify unreadable/invalid "+p+": "+e.message);process.exit(1)}}
if(!c||typeof c!=="object"||Array.isArray(c)){console.error("Unexpected config shape in "+p);process.exit(1)}
if(fs.existsSync(p))fs.copyFileSync(p,p+".bak");
(c.mcpServers??={}).owlaso={command:process.execPath,args:[process.env.ENTRY],env:{OWLASO_DIR:process.env.OWLASO_DIR}};
const tmp=p+".tmp-"+process.pid;
fs.writeFileSync(tmp,JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(tmp,p);
console.log("Claude Desktop config updated:",p)'
echo "Done. Restart Claude Desktop."
