# Xcode Agent Runner

A ticket-driven AI agent system for iOS development with real-time streaming.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   GitHub    │────▶│   Router    │────▶│   Worker    │
│   Webhook   │     │   (HTTP)    │     │   (PTY)     │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                │
                       ┌────────────────────────┘
                       ▼
              ┌─────────────────┐
              │  Claude CLI     │
              │  (Agent)        │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  XcodeBuilder   │
              │  (xcodebuild)   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │    Bridge       │
              │  (WebSocket)    │
              └────────┬────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    ┌─────────┐   ┌─────────┐   ┌─────────┐
    │ Telegram│   │ Web UI  │   │ Console │
    └─────────┘   └─────────┘   └─────────┘
```

## Components

### 1. Router (`src/router.ts`)
- HTTP server for GitHub webhooks
- Manual trigger endpoint
- Health checks and agent status
- Accepts issues labeled `agent:opus` or `agent:sonnet`

### 2. Worker (`src/worker.ts`)
- Spawns Claude CLI in PTY
- Manages bidirectional communication
- Watches input file for user commands
- Streams output to bridge

### 3. Xcode (`src/xcode.ts`)
- `xcodebuild` wrapper with streaming
- Error parsing (file, line, message)
- Build and test execution
- Real-time output formatting

### 4. Bridge (`src/bridge.ts`)
- WebSocket server for streaming
- Message buffering for new clients
- Formatted console output
- Command routing

### 5. Environment (`src/environment.ts`)
- GitHub API integration
- Workspace setup and cleanup
- Repository cloning
- `.env` secrets injection

## Quick Start

```bash
# 1. Setup
cd ~/workspace/xcode-agent
./setup.sh

# 2. Configure
vim .env  # Add your GitHub token

# 3. Start
npm start
```

## Configuration

### Environment Variables

```bash
PORT=3000                    # HTTP server port
WEBHOOK_SECRET=xxx           # GitHub webhook secret
GITHUB_TOKEN=ghp_xxx         # GitHub personal access token
BRIDGE_WS_PORT=8080          # WebSocket port
WORKSPACE_BASE=/tmp/agent-work
SECRETS_BASE=~/.agent-secrets
```

### Repository Secrets

Place `.env` files in `~/.agent-secrets/<owner-repo>/env`:

```
~/.agent-secrets/
├── myorg-myapp/
│   └── env          # API keys, certs, etc.
└── other-repo/
    └── env
```

## API Endpoints

### GitHub Webhook
```
POST /webhook/github
X-GitHub-Event: issues
```

Trigger: Label issue with `agent:opus` or `agent:sonnet`

### Manual Trigger
```bash
POST /trigger
Content-Type: application/json

{
  "owner": "myorg",
  "repo": "myapp",
  "issue": 123,
  "agentType": "sonnet"  // or "opus"
}
```

### Health Check
```bash
GET /health
```

### List Agents
```bash
GET /agents
```

## WebSocket Protocol

Connect to `ws://localhost:8080`

### Message Format
```json
{
  "type": "output|error|thought|code|build|complete|input",
  "content": "message text",
  "timestamp": 1711234567890,
  "metadata": { "ticketId": "..." }
}
```

### Send Commands
```json
{
  "command": "check the tests",
  "target": "optional-ticket-id"
}
```

## Bidirectional Chat

Agent reads from: `/tmp/agent-work/<ticket-id>/input`

Write commands to this file to communicate with the agent:

```bash
echo "check the tests" > /tmp/agent-work/owner-repo-123/input
```

## Agent Behavior

When started, the agent will:

1. **Explore** - Read ticket, understand codebase
2. **Plan** - Form implementation approach
3. **Implement** - Write code changes
4. **Build** - Run `xcodebuild` and fix errors
5. **Test** - Run tests if available
6. **Commit** - `git commit` with clear message
7. **Push** - Create branch `agent/<ticket-id>-<description>`
8. **Report** - Summarize changes

## Output Format

```
[Xcode] Build started: MyApp
[Xcode] ❌ Error: ViewController.swift:42:15: Cannot convert value
[Xcode] ✅ Build succeeded
[Agent] 💭 The error is in the binding code...
[Agent] 📝 Modified: ViewController.swift
[Xcode] Build started: MyApp
[Xcode] ✅ Build succeeded
[Agent] ✅ Committed changes to agent/123-fix-binding
```

## Development

```bash
# Install deps
npm install

# Run in dev mode
npm run dev

# Type check
npx tsc --noEmit
```

## Troubleshooting

### Build fails with "scheme not found"
The agent tries to infer the scheme. If it fails, the agent will ask for clarification or try common scheme names.

### Claude CLI not found
Install: `npm install -g @anthropic-ai/claude-cli`

### Webhook not triggering
- Verify `WEBHOOK_SECRET` matches GitHub webhook settings
- Check GitHub webhook delivery logs
- Test with manual trigger first

### Workspace permissions
Ensure the workspace base directory is writable:
```bash
chmod 755 /tmp/agent-work
```

## License

MIT