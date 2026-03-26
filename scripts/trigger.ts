#!/usr/bin/env tsx
/**
 * CLI tool for manually triggering Xcode Agent Runner
 * Usage: ./trigger.ts --owner <owner> --repo <repo> --issue <number> [--agent sonnet|opus]
 */

import { AgentEnvironment } from "../src/environment.js";
import { AgentWorker } from "../src/worker.js";
import { AgentBridge } from "../src/bridge.js";
import * as dotenv from "dotenv";
import * as fs from "fs/promises";

dotenv.config();

interface CliArgs {
  owner: string;
  repo: string;
  issue: number;
  agent: "sonnet" | "opus";
  skipBuild: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: Partial<CliArgs> = { agent: "sonnet", skipBuild: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--owner":
        result.owner = args[++i];
        break;
      case "--repo":
        result.repo = args[++i];
        break;
      case "--issue":
        result.issue = parseInt(args[++i], 10);
        break;
      case "--agent":
        result.agent = args[++i] as "sonnet" | "opus";
        break;
      case "--skip-build":
        result.skipBuild = true;
        break;
      case "--help":
        showHelp();
        process.exit(0);
    }
  }

  if (!result.owner || !result.repo || !result.issue) {
    console.error("❌ Missing required arguments\n");
    showHelp();
    process.exit(1);
  }

  return result as CliArgs;
}

function showHelp() {
  console.log(`
Usage: trigger.ts [options]

Options:
  --owner <owner>      GitHub repository owner (required)
  --repo <repo>        Repository name (required)
  --issue <number>     Issue number to process (required)
  --agent <type>       Agent type: sonnet or opus (default: sonnet)
  --skip-build         Skip initial build verification
  --help               Show this help

Examples:
  # Basic usage
  ./trigger.ts --owner myorg --repo myapp --issue 123

  # Use Opus agent
  ./trigger.ts --owner myorg --repo myapp --issue 123 --agent opus

  # Skip build check
  ./trigger.ts --owner myorg --repo myapp --issue 123 --skip-build
`);
}

async function main() {
  const args = parseArgs();
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  if (!GITHUB_TOKEN) {
    console.error("❌ GITHUB_TOKEN not set in .env");
    process.exit(1);
  }

  console.log(`🦞 Xcode Agent Runner`);
  console.log(`====================\n`);
  console.log(`Repository: ${args.owner}/${args.repo}`);
  console.log(`Issue: #${args.issue}`);
  console.log(`Agent: ${args.agent}\n`);

  const environment = new AgentEnvironment(GITHUB_TOKEN);
  const bridge = new AgentBridge({ port: parseInt(process.env.BRIDGE_WS_PORT || "8080", 10) });

  // Handle commands from bridge
  bridge.on("command", async (cmd) => {
    console.log(`\n[Command] ${cmd.command}`);
    
    // Write to input file
    const context = (global as any).currentContext;
    if (context) {
      await fs.appendFile(context.inputFilePath, cmd.command + "\n");
    }
  });

  try {
    // Fetch ticket
    console.log("📋 Fetching ticket from GitHub...");
    const ticket = await environment.fetchTicket(args.owner, args.repo, args.issue);
    ticket.agentType = args.agent;
    
    console.log(`   Title: ${ticket.title}`);
    console.log(`   Labels: agent:${ticket.agentType}\n`);

    // Setup workspace
    console.log("🔧 Setting up workspace...");
    const context = await environment.setupWorkspace(ticket);
    (global as any).currentContext = context;
    
    console.log(`   Path: ${context.workspacePath}`);
    console.log(`   Repo: ${context.repoPath}\n`);

    // Verify build (unless skipped)
    if (!args.skipBuild) {
      console.log("🔨 Verifying project builds...");
      const buildResult = await environment.verifyBuild(context.repoPath);
      
      if (!buildResult.success) {
        console.warn("⚠️  Initial build failed - agent will need to fix this");
        console.log(buildResult.output.slice(0, 500));
      } else {
        console.log("✅ Project builds successfully\n");
      }
    }

    // Create and start worker
    console.log("🚀 Starting agent...\n");
    const worker = new AgentWorker(context);

    worker.on("message", (msg) => {
      bridge.broadcast({
        ...msg,
        metadata: {
          ...msg.metadata,
          ticketId: ticket.id,
          ticketNumber: ticket.number,
        },
      });
    });

    worker.on("complete", async () => {
      console.log("\n✅ Agent completed");
      
      // Cleanup
      bridge.close();
      
      // Optional: cleanup workspace
      // await environment.cleanup(context.workspacePath);
      
      process.exit(0);
    });

    await worker.start();

    // Keep process alive
    process.stdin.resume();
    
    // Handle Ctrl+C
    process.on("SIGINT", async () => {
      console.log("\n\n🛑 Stopping agent...");
      worker.stop();
      bridge.close();
      process.exit(0);
    });

  } catch (error) {
    console.error("\n❌ Error:", error);
    bridge.close();
    process.exit(1);
  }
}

main().catch(console.error);