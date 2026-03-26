import { spawn } from "node-pty";
import { EventEmitter } from "events";
import * as fs from "fs/promises";
import { AgentContext } from "./environment.js";
import { XcodeBuilder } from "./xcode.js";
import { CompletionHandler, CompletionResult } from "./completion.js";

export interface AgentMessage {
  type: "output" | "error" | "thought" | "code" | "build" | "complete" | "input" | "pr";
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Agent runner that spawns Claude CLI in PTY and manages bidirectional communication
 */
export class AgentWorker extends EventEmitter {
  private context: AgentContext;
  private ptyProcess: any = null;
  private xcodeBuilder: XcodeBuilder;
  private inputWatcher: any = null;
  private isRunning = false;
  private completionHandler: CompletionHandler;

  constructor(context: AgentContext, githubToken?: string) {
    super();
    this.context = context;
    this.xcodeBuilder = new XcodeBuilder(context.repoPath);
    this.completionHandler = new CompletionHandler(githubToken || process.env.GITHUB_TOKEN || "");
  }

  /**
   * Start the agent worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Agent already running");
    }

    this.isRunning = true;
    
    // Build system prompt with ticket context
    const systemPrompt = this.buildSystemPrompt();
    
    // Spawn Claude CLI in PTY
    const claudeArgs = [
      "-p",
      "--permission-mode", "bypassPermissions",
      "--system", systemPrompt,
    ];

    console.log(`[Worker] Starting Claude CLI for ticket #${this.context.ticket.number}...`);
    
    this.ptyProcess = spawn("claude", claudeArgs, {
      cwd: this.context.repoPath,
      env: {
        ...process.env,
        CLAUDE_WORKING_DIR: this.context.repoPath,
      } as { [key: string]: string },
      cols: 120,
      rows: 40,
    });

    // Stream output and watch for completion signal
    this.ptyProcess.onData((data: string) => {
      // Check for DONE signal
      if (data.includes("DONE:")) {
        const match = data.match(/DONE:\s*(.+)/);
        if (match) {
          this.handleCompletion(match[1]);
        }
      }
      
      this.emit("message", {
        type: "output",
        content: data,
        timestamp: Date.now(),
      });
    });

    this.ptyProcess.onExit((code: number) => {
      this.isRunning = false;
      this.stopInputWatcher();
      
      this.emit("message", {
        type: "complete",
        content: `Agent exited with code ${code}`,
        timestamp: Date.now(),
        metadata: { exitCode: code },
      });
    });

    // Start watching for input from user
    this.startInputWatcher();

    // Send initial context
    this.sendToAgent(`
Ticket #${this.context.ticket.number}: ${this.context.ticket.title}

${this.context.ticket.body}

---
You are in the repository at: ${this.context.repoPath}
Available commands:
- Use xcodebuild to build and test
- Read/write files to implement changes
- Git commands to commit and push

Start by exploring the codebase and understanding the requirements.
`);
  }

  /**
   * Send message to agent via PTY
   */
  sendToAgent(message: string): void {
    if (this.ptyProcess && this.isRunning) {
      this.ptyProcess.write(message + "\n");
    }
  }

  /**
   * Execute xcodebuild command and stream results
   */
  async runBuild(scheme?: string): Promise<void> {
    this.xcodeBuilder.on("data", (data: string) => {
      this.emit("message", {
        type: "build",
        content: data,
        timestamp: Date.now(),
      });
    });

    const result = await this.xcodeBuilder.build(scheme);
    
    this.emit("message", {
      type: "build",
      content: `Build ${result.success ? "succeeded" : "failed"}`,
      timestamp: Date.now(),
      metadata: { errors: result.errors, success: result.success },
    });
  }

  /**
   * Stop the agent worker
   */
  stop(): void {
    this.isRunning = false;
    
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    
    this.xcodeBuilder.kill();
    this.stopInputWatcher();
  }

  /**
   * Watch input file for user commands
   */
  private startInputWatcher(): void {
    let lastContent = "";
    
    const checkInput = async () => {
      if (!this.isRunning) return;
      
      try {
        const content = await fs.readFile(this.context.inputFilePath, "utf-8");
        if (content !== lastContent && content.trim()) {
          lastContent = content;
          
          // New input received
          const lines = content.trim().split("\n");
          const newLines = lines.slice(lastContent.split("\n").length - 1);
          
          for (const line of newLines) {
            if (line.trim()) {
              this.emit("message", {
                type: "input",
                content: line,
                timestamp: Date.now(),
              });
              this.sendToAgent(line);
            }
          }
        }
      } catch {
        // File might not exist yet
      }
      
      this.inputWatcher = setTimeout(checkInput, 500);
    };
    
    checkInput();
  }

  private stopInputWatcher(): void {
    if (this.inputWatcher) {
      clearTimeout(this.inputWatcher);
      this.inputWatcher = null;
    }
  }

  /**
   * Build system prompt for Claude
   */
  private buildSystemPrompt(): string {
    return `
You are an expert iOS developer working on a ticket. You have access to:
- The full codebase in ${this.context.repoPath}
- Xcode build tools
- Git for version control

Your task is to:
1. Read and understand the ticket requirements
2. Explore the codebase to understand the structure
3. Implement the necessary changes
4. Build and verify your changes compile
5. Run tests if available
6. Commit your changes with a clear message
7. Push to a branch named: agent/<ticket-id>-<description>

When building:
- Use xcodebuild commands
- Report errors clearly with file paths and line numbers
- Fix any compilation errors

When done:
- Type "DONE: <summary of changes>" 
- The system will automatically commit, push, and create a PR

Ticket: ${this.context.ticket.title}
Agent Type: ${this.context.ticket.agentType}
`.trim();
  }

  private sanitizeBranchName(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }

  /**
   * Handle agent completion - commit, push, create PR
   */
  private async handleCompletion(summary: string): Promise<void> {
    console.log(`[Worker] Agent signaled completion: ${summary}`);
    
    this.emit("message", {
      type: "thought",
      content: `Completing task: ${summary}`,
      timestamp: Date.now(),
    });

    const result = await this.completionHandler.complete(this.context, summary);

    if (result.success) {
      this.emit("message", {
        type: "pr",
        content: `✅ Task completed!\nBranch: ${result.branch}\nCommit: ${result.commitHash?.slice(0, 7)}\nPR: ${result.prUrl || "N/A"}`,
        timestamp: Date.now(),
        metadata: result,
      });
    } else {
      this.emit("message", {
        type: "error",
        content: `❌ Completion failed: ${result.summary}`,
        timestamp: Date.now(),
      });
    }
  }
}