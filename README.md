# Xcode Agent Runner

Ticket-driven AI agent backend for the macOS Xcode Agent UI.

## What it does

- exposes an HTTP router on `http://127.0.0.1:3800`
- exposes a WebSocket bridge on `ws://127.0.0.1:9300`
- clones the target repo for a ticket
- spawns Claude CLI against that clone
- streams agent output into the UI using the envelope protocol the app expects

This repo is the backend half of the local setup. The frontend half lives in `XcodeAgentUI`.

## Fresh-clone happy path

### 1. Clone and install

```bash
git clone <backend-repo-url> xcode-agent
cd xcode-agent
npm install
cp .env.example .env
```

### 2. Configure `.env`

Minimum viable local config:

```bash
PORT=3800
BRIDGE_WS_PORT=9300
GITHUB_TOKEN=ghp_...
ALLOW_LOCAL_UNAUTHENTICATED=true
```

Notes:
- `GITHUB_TOKEN` is required for real ticket execution because the backend fetches issue/repo metadata from GitHub.
- `BEARER_TOKEN` is optional for local-only use. Add it when exposing the service beyond loopback.
- local UI → backend traffic works without auth when `ALLOW_LOCAL_UNAUTHENTICATED=true`.

### 3. Start the backend

```bash
npm start
```

Expected startup lines:

```text
[Bridge] WebSocket server listening on port 9300
HTTP server listening on port 3800
Ready for GitHub webhooks at /webhook/github
Manual trigger at POST /trigger
Health check at GET /api/health
```

### 4. Verify connectivity

```bash
npm run smoke:connection
```

That confirms:
- router health responds
- bridge accepts WebSocket clients
- `/trigger` emits a bridge event the UI can consume

## UI contract

The bridge emits typed envelopes, not raw worker frames.

Envelope shape:

```json
{
  "type": "agent_output",
  "from": "agent",
  "ts": "2026-03-26T15:00:00.000Z",
  "payload": "message text"
}
```

Important emitted event types:
- `agent_output`
- `agent_error`
- `agent_status`
- `file_changed`
- `agent_approval_request`
- `build_result`
- `system`

Client commands sent back over WebSocket are still plain JSON:

```json
{
  "command": "check the tests",
  "target": "owner-repo-123",
  "timestamp": 1711234567890
}
```

## Local UI-driven run flow

When the macOS app starts a Mission Control session it should:
1. connect to the bridge as a human client
2. POST `/trigger` via `npm run trigger:ui`
3. pass the ticket id as `ISSUE` / `TICKET_ID`
4. send steering commands over WebSocket with `target = <ticket-id>`

The backend expects ticket ids in this form:

```text
<owner>-<repo>-<issueNumber>
```

For the current UI-trigger helper, owner defaults to `local` and repo defaults to the project name unless overridden with env vars.

## Scripts

```bash
npm start              # main local backend: HTTP API + WebSocket bridge
npm run router         # same as start
npm run bridge         # bridge-only debug entrypoint; not the normal UI/dev path
npm run trigger:ui     # POST /trigger using env vars from the app
npm run smoke:connection
npm test
```

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3800` | HTTP router port |
| `BRIDGE_WS_PORT` | `9300` | WebSocket bridge port |
| `GITHUB_TOKEN` | – | GitHub API auth for fetching ticket + repo metadata |
| `WEBHOOK_SECRET` | empty | GitHub webhook signature validation |
| `BEARER_TOKEN` | empty | optional auth token for non-loopback clients |
| `ALLOW_LOCAL_UNAUTHENTICATED` | `true` | allow localhost without bearer token |
| `WORKSPACE_BASE` | `/tmp/agent-work` | clone/build workspace root |
| `SECRETS_BASE` | `~/.agent-secrets` | optional per-repo env injection |

## Testing

```bash
npm test
npm run smoke:connection
```

## Known limitations

- real ticket execution still depends on valid GitHub access, reachable repo URLs, and a working local `claude` CLI
- `/trigger` now validates GitHub issue access before returning `202 Accepted`
- the smoke test only verifies router + bridge connectivity and trigger emission, not a full agent coding run
- the worker still uses GitHub-backed ticket lookup rather than a fully local mock ticket path

## License

MIT
