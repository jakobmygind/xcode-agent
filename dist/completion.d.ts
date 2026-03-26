import { AgentContext } from "./environment.js";
export interface CompletionResult {
    success: boolean;
    branch: string;
    commitHash?: string;
    prUrl?: string;
    summary: string;
    filesChanged: string[];
}
/**
 * Handles agent completion: commit, push, and create PR
 */
export declare class CompletionHandler {
    private octokit;
    constructor(token: string);
    /**
     * Complete the agent task: commit, push, and optionally create PR
     */
    complete(context: AgentContext, summary: string, createPr?: boolean): Promise<CompletionResult>;
    /**
     * Generate branch name from ticket
     */
    private generateBranchName;
    /**
     * Generate commit message
     */
    private generateCommitMessage;
    /**
     * Generate PR body
     */
    private generatePrBody;
}
//# sourceMappingURL=completion.d.ts.map