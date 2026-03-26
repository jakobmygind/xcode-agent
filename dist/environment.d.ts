export interface Ticket {
    id: string;
    number: number;
    title: string;
    body: string;
    agentType: "opus" | "sonnet";
    repo: {
        owner: string;
        name: string;
        cloneUrl: string;
    };
    branch?: string;
}
export interface AgentContext {
    ticket: Ticket;
    workspacePath: string;
    secretsPath: string;
    inputFilePath: string;
    repoPath: string;
}
export declare class AgentEnvironment {
    private octokit;
    private workspaceBase;
    private secretsBase;
    constructor(token: string);
    /**
     * Fetch ticket details from GitHub issue
     */
    fetchTicket(owner: string, repo: string, issueNumber: number): Promise<Ticket>;
    /**
     * Setup workspace for agent execution
     */
    setupWorkspace(ticket: Ticket): Promise<AgentContext>;
    /**
     * Verify project builds
     */
    verifyBuild(repoPath: string): Promise<{
        success: boolean;
        output: string;
    }>;
    /**
     * Clean up workspace
     */
    cleanup(workspacePath: string): Promise<void>;
}
//# sourceMappingURL=environment.d.ts.map