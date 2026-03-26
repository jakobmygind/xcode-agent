#!/usr/bin/env tsx
/**
 * Manual test script for Xcode Agent Runner
 * Simulates a ticket trigger without GitHub webhook
 */

import { AgentEnvironment } from "../src/environment.js";
import { AgentWorker } from "../src/worker.js";
import { AgentBridge } from "../src/bridge.js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as os from "os";

dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

async function testWithDummyTicket() {
  console.log("🧪 Testing Xcode Agent Runner with dummy ticket\n");

  if (!GITHUB_TOKEN) {
    console.error("❌ GITHUB_TOKEN not set in .env");
    console.log("   Get a token at: https://github.com/settings/tokens");
    process.exit(1);
  }

  // Create a dummy ticket for testing
  const dummyTicket = {
    id: "test-dummy-001",
    number: 1,
    title: "Test: Add basic SwiftUI view",
    body: `## Test Ticket

This is a dummy ticket for testing the Xcode Agent Runner.

### Acceptance Criteria
- [ ] Create a simple SwiftUI view
- [ ] Add preview
- [ ] Verify it builds

### Notes
This is just a test. No actual implementation needed.`,
    agentType: "sonnet" as const,
    repo: {
      owner: "jakobmygind",
      name: "test-repo", // You'll need to change this to a real repo
      cloneUrl: "https://github.com/jakobmygind/test-repo.git",
    },
  };

  console.log("📋 Test Ticket:");
  console.log(`   Title: ${dummyTicket.title}`);
  console.log(`   Agent: ${dummyTicket.agentType}`);
  console.log(`   Repo: ${dummyTicket.repo.owner}/${dummyTicket.repo.name}\n`);

  // Initialize components
  const environment = new AgentEnvironment(GITHUB_TOKEN);
  const bridge = new AgentBridge({ port: 8080 });

  // Forward bridge messages to console
  bridge.on("command", (cmd) => {
    console.log(`\n[Bridge Command] ${cmd.command}`);
  });

  try {
    console.log("🔧 Setting up workspace...");
    
    // Override workspace path for test
    const workspacePath = path.join(os.tmpdir(), "agent-work", "test-dummy-001");
    
    // Create context manually (skip actual clone for test)
    const context = {
      ticket: dummyTicket,
      workspacePath,
      secretsPath: path.join(os.homedir(), ".agent-secrets", "test-repo"),
      inputFilePath: path.join(workspacePath, "input"),
      repoPath: path.join(workspacePath, "repo"),
    };

    console.log(`   Workspace: ${workspacePath}`);
    console.log(`   Input file: ${context.inputFilePath}\n`);

    // Create workspace and input file
    const fs = await import("fs/promises");
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(context.inputFilePath, "", { flag: "w" });

    console.log("🚀 Starting agent worker...");
    console.log("   (This would spawn Claude CLI in a real scenario)\n");

    // Create worker
    const worker = new AgentWorker(context);

    // Forward all messages
    worker.on("message", (msg) => {
      console.log(`[${msg.type}] ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`);
      
      // Also broadcast to bridge
      bridge.broadcast({
        ...msg,
        metadata: { ticketId: "test-dummy-001" },
      });
    });

    // Simulate agent lifecycle
    console.log("\n📡 Simulating agent output...\n");

    // Simulate some messages
    const messages = [
      { type: "thought" as const, content: "Reading ticket requirements..." },
      { type: "thought" as const, content: "This is a test ticket for SwiftUI view creation" },
      { type: "output" as const, content: "Exploring repository structure...\n" },
      { type: "build" as const, content: "[Xcode] Build started: TestApp" },
      { type: "build" as const, content: "[Xcode] ✅ Build succeeded" },
      { type: "code" as const, content: "Created ContentView.swift with basic SwiftUI view" },
      { type: "complete" as const, content: "Test completed successfully" },
    ];

    for (const msg of messages) {
      await new Promise(r => setTimeout(r, 500));
      worker.emit("message", { ...msg, timestamp: Date.now() });
    }

    console.log("\n✅ Test completed!");
    console.log("\nWebSocket bridge is running on ws://localhost:8080");
    console.log("Press Ctrl+C to exit");

    // Keep running for WebSocket testing
    setInterval(() => {}, 1000);

  } catch (error) {
    console.error("\n❌ Test failed:", error);
    bridge.close();
    process.exit(1);
  }
}

// Run test
testWithDummyTicket().catch(console.error);