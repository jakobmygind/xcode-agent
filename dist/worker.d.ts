import { EventEmitter } from "events";
import { AgentContext } from "./environment.js";
export interface AgentMessage {
    type: "output" | "error" | "thought" | "code" | "build" | "complete" | "input" | "pr";
    content: string;
    timestamp: number;
    metadata?: Record<string, any>;
}
/**
 * Agent runner that spawns Claude CLI in PTY and manages bidirectional communication
 */
export declare class AgentWorker extends EventEmitter {
    private context;
    private ptyProcess;
    private xcodeBuilder;
    private inputWatcher;
    private isRunning;
    private completionHandler;
    constructor(context: AgentContext, githubToken?: string);
    /**
     * Start the agent worker
     */
    start(): Promise<void>;
    /**
     * Send message to agent via PTY
     */
    sendToAgent(message: string): void;
    /**
     * Execute xcodebuild command and stream results
     */
    runBuild(scheme?: string): Promise<void>;
    /**
     * Stop the agent worker
     */
    stop(): void;
    /**
     * Watch input file for user commands
     */
    private startInputWatcher;
    private stopInputWatcher;
    /**
     * Build system prompt for Claude
     */
    private buildSystemPrompt;
    private sanitizeBranchName;
    /**
     * Handle agent completion - commit, push, create PR
     */
    private handleCompletion;
}
//# sourceMappingURL=worker.d.ts.map