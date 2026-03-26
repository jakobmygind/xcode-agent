#!/bin/bash

# Xcode Agent Runner Setup Script
# One-time setup for the ticket-driven AI agent system

set -e

echo "🦞 Xcode Agent Runner Setup"
echo "============================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo ""
echo "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "${RED}❌ Node.js 18+ required. Found: $(node --version)${NC}"
    exit 1
fi
echo "${GREEN}✓ Node.js $(node --version)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "${RED}❌ npm not found${NC}"
    exit 1
fi
echo "${GREEN}✓ npm $(npm --version)${NC}"

# Check git
if ! command -v git &> /dev/null; then
    echo "${RED}❌ git not found${NC}"
    exit 1
fi
echo "${GREEN}✓ git $(git --version | cut -d' ' -f3)${NC}"

# Check Xcode
if ! command -v xcodebuild &> /dev/null; then
    echo "${RED}❌ xcodebuild not found. Please install Xcode${NC}"
    exit 1
fi
echo "${GREEN}✓ Xcode $(xcodebuild -version | head -1)${NC}"

# Check Claude CLI
if ! command -v claude &> /dev/null; then
    echo "${YELLOW}⚠️  Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-cli${NC}"
else
    echo "${GREEN}✓ Claude CLI found${NC}"
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Create required directories
echo ""
echo "Creating directories..."

WORKSPACE_BASE="${WORKSPACE_BASE:-/tmp/agent-work}"
SECRETS_BASE="${SECRETS_BASE:-$HOME/.agent-secrets}"

mkdir -p "$WORKSPACE_BASE"
mkdir -p "$SECRETS_BASE"

echo "${GREEN}✓ Workspace: $WORKSPACE_BASE${NC}"
echo "${GREEN}✓ Secrets: $SECRETS_BASE${NC}"

# Setup .env if not exists
if [ ! -f .env ]; then
    echo ""
    echo "Creating .env file..."
    cp .env.example .env
    echo "${YELLOW}⚠️  Please edit .env with your configuration${NC}"
else
    echo "${GREEN}✓ .env already exists${NC}"
fi

# Create example secrets structure
echo ""
echo "Setting up secrets structure..."
mkdir -p "$SECRETS_BASE/example-repo"
if [ ! -f "$SECRETS_BASE/example-repo/env" ]; then
    cat > "$SECRETS_BASE/example-repo/env" << 'EOF'
# Example .env for a repository
# Copy this to ~/.agent-secrets/<owner-repo>/env
API_KEY=your-api-key
OTHER_SECRET=secret-value
EOF
    echo "${GREEN}✓ Created example secrets at $SECRETS_BASE/example-repo/env${NC}"
fi

# Make scripts executable
chmod +x setup.sh

# Build TypeScript
echo ""
echo "Building TypeScript..."
npm run build 2>/dev/null || echo "${YELLOW}⚠️  Build skipped (no build script)${NC}"

echo ""
echo "============================"
echo "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Edit .env with your GitHub token and webhook secret"
echo "2. Add repository secrets to $SECRETS_BASE/<owner-repo>/env"
echo "3. Start the router: ${YELLOW}npm start${NC}"
echo "4. Configure GitHub webhook: ${YELLOW}http://your-server:3000/webhook/github${NC}"
echo ""
echo "Manual trigger example:"
echo "  curl -X POST http://localhost:3000/trigger \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"owner\":\"myorg\",\"repo\":\"myapp\",\"issue\":123,\"agentType\":\"sonnet\"}'"
echo ""
echo "WebSocket bridge available on port 8080"
echo "============================"