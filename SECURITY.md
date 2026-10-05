# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

Only the latest release on `main` receives fixes. Issues in the OwlASO backend itself belong to [owlaso/owlaso](https://github.com/owlaso/owlaso/security/policy).

## Reporting a Vulnerability

Report privately via a [GitHub Security Advisory](https://github.com/owlaso/owlaso-mcp/security/advisories/new) ("Report a vulnerability" on the Security tab). Do not open a public issue. Include the affected version or commit, your MCP client, the env vars in play (`OWLASO_URL` / `OWLASO_DIR`, …) and reproduction steps.

Scope, out-of-scope issues, disclosure timeline and safe harbor: <https://owlaso.github.io/security/>.

## Security Model

- **Read-only tools.** Every tool is a `GET` against OwlASO's local API and is annotated `readOnlyHint`. Inputs are validated with strict zod schemas (bounded lengths, regex-checked ids, country/language codes and dates) before any request is built.
- **Loopback backend.** With `OWLASO_DIR`, the spawned server is pinned to `HOST=127.0.0.1` (after the inherited env, so it can't be overridden) and binds an ephemeral port itself (`PORT=0`), reporting it over IPC. No port is reserved in advance, so no local process can race for it. The child exits when this server does, including on `SIGKILL`.
- **Strict base URL.** `OWLASO_URL` must be plain `http(s)`; credentials, query strings and fragments are rejected.
- **No redirects.** All backend requests use `redirect: 'error'`, so a backend can't bounce traffic to another host.
- **Bounded resources.** Per-request timeout (`OWLASO_TIMEOUT_MS`), backend response byte cap (`OWLASO_MAX_RESPONSE_BYTES`), output cap (`OWLASO_MAX_CHARS`) and truncated error bodies. Invalid numeric env values fall back to safe defaults.
- **Clean stdio.** The child's stdout is discarded so it can't inject frames into the MCP transport.
- **Installer.** `scripts/install.sh` runs with `set -euo pipefail`, clones over HTTPS, updates with `pull --ff-only`, backs up `claude_desktop_config.json` to `.bak`, and aborts rather than overwriting an unreadable or invalid config.

### Out of scope

- Prompt injection carried in third-party store data (app listings, reviews). Tool output is untrusted text; clients should treat it as such.
- Pointing `OWLASO_URL` at a backend you don't control.
