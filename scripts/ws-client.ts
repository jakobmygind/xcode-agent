#!/usr/bin/env tsx
/**
 * WebSocket client for testing the Xcode Agent bridge
 * Usage: ./ws-client.ts [--port 8080]
 */

import WebSocket from "ws";

const PORT = parseInt(process.argv.find((_, i, arr) => arr[i - 1] === "--port") || "8080", 10);

console.log(`🔌 Connecting to ws://localhost:${PORT}...\n`);

const ws = new WebSocket(`ws://localhost:${PORT}`);

ws.on("open", () => {
  console.log("✅ Connected to bridge\n");
  console.log("Messages will appear below. Press Ctrl+C to exit.\n");
  console.log("-".repeat(60));
});

ws.on("message", (data: Buffer) => {
  try {
    const msg = JSON.parse(data.toString());
    const time = new Date(msg.timestamp).toLocaleTimeString();
    
    // Format based on type
    const icons: Record<string, string> = {
      output: "📝",
      error: "❌",
      thought: "💭",
      code: "📝",
      build: "🔨",
      complete: "✅",
      input: "📥",
    };
    
    const icon = icons[msg.type] || "📄";
    
    if (msg.type === "output") {
      // Stream output directly
      process.stdout.write(msg.content);
    } else {
      console.log(`\n[${time}] ${icon} [${msg.type.toUpperCase()}]`);
      console.log(msg.content);
      if (msg.metadata?.ticketId) {
        console.log(`   📎 Ticket: ${msg.metadata.ticketId}`);
      }
    }
  } catch (e) {
    console.log(data.toString());
  }
});

ws.on("error", (err) => {
  console.error("❌ WebSocket error:", err.message);
  process.exit(1);
});

ws.on("close", () => {
  console.log("\n🔌 Disconnected");
  process.exit(0);
});

// Handle Ctrl+C
process.on("SIGINT", () => {
  ws.close();
  process.exit(0);
});