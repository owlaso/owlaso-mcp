# owlaso-mcp

MCP (stdio) server for the [OwlASO](https://github.com/owlaso/owlaso) desktop app: ASO keyword analysis and app store review data for AI clients.

It talks to OwlASO's local HTTP API. The Electron build serves its UI over a private `app://` scheme, so run the web mode (same router) or let this server spawn it.

## Tools

| Tool | API |
|---|---|
| `owlaso_health` | `/api/health` |
| `search_apps` | `/api/search` |
| `analyze_keyword` | `/api/asosearch` |
| `keyword_history` | `/api/asosearch/history` |
| `app_details` | `/api/app-details` |
| `get_reviews` | `/api/reviews` (all filters) |
| `get_full_reviews` | `/api/reviews.full` (stats + `reviewsPerGroup` rows, default 25; `0` = stats only) |

All read-only. Output is capped at `OWLASO_MAX_CHARS` (default 100000).

## Backend

| Env | Behaviour |
|---|---|
| `OWLASO_URL` | Use a running instance (`npm start` in owlaso) |
| `OWLASO_DIR` | Spawn `src/server.js` from an owlaso checkout. It binds an ephemeral loopback port itself (`PORT=0`) and reports it over IPC, so no other local process can grab the port first; it exits when this server does (even on SIGKILL) |
| neither | `http://127.0.0.1:3000` |

Also: `OWLASO_TIMEOUT_MS` (120000), `OWLASO_MAX_RESPONSE_BYTES` (64 MiB backend response cap). Invalid numeric values fall back to defaults. `OWLASO_URL` must be a plain `http(s)` URL (no credentials/query); redirects are refused. Env is passed through to the spawned server (`MOCK_STORE_DATA=1`, `RANK_HISTORY_DIR`, …).

## Install (local)

```bash
curl -fsSL https://raw.githubusercontent.com/owlaso/owlaso-mcp/main/scripts/install.sh | bash
```

Clones both repos into `~/mcp-connectors` (override: `MCP_CONNECTORS_DIR`), runs `npm ci`, registers with Claude Code (`claude mcp add -s user`) and Claude Desktop (merges `claude_desktop_config.json`, keeping a `.bak`; aborts instead of overwriting an invalid config).

## Client config

```json
{
  "mcpServers": {
    "owlaso": {
      "command": "node",
      "args": ["/path/to/owlaso-mcp/src/index.js"],
      "env": { "OWLASO_DIR": "/path/to/owlaso" }
    }
  }
}
```

## Dev

```bash
npm install
npm test   # e2e: spawns owlaso with mock data (OWLASO_DIR, default ../owlaso)
```
