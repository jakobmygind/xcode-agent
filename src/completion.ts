import { Octokit } from "@octokit/rest";
import { AgentContext } from "./environment.js";
import { execSync } from "child_process";

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
export class CompletionHandler {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Complete the agent task: commit, push, and optionally create PR
   */
  async complete(
    context: AgentContext,
    summary: string,
    createPr = true
  ): Promise<CompletionResult> {
    const { repoPath, ticket } = context;
    const branchName = this.generateBranchName(ticket);
    
    try {
      // Check if there are changes
      const status = execSync("git status --porcelain", {
        cwd: repoPath,
        encoding: "utf-8",
      });

      if (!status.trim()) {
        return {
          success: false,
          branch: branchName,
          summary: "No changes to commit",
          filesChanged: [],
        };
      }

      // Get list of changed files
      const filesChanged = status
        .split("\n")
        .filter(line => line.trim())
        .map(line => line.slice(3));

      // Create branch
      console.log(`[Completion] Creating branch: ${branchName}`);
      execSync(`git checkout -b ${branchName}`, { cwd: repoPath });

      // Stage and commit
      console.log(`[Completion] Committing changes...`);
      execSync("git add -A", { cwd: repoPath });
      
      const commitMessage = this.generateCommitMessage(ticket, summary);
      execSync(`git commit -m "${commitMessage}"`, { cwd: repoPath });

      // Get commit hash
      const commitHash = execSync("git rev-parse HEAD", {
        cwd: repoPath,
        encoding: "utf-8",
      }).trim();

      // Push branch
      console.log(`[Completion] Pushing to origin...`);
      execSync(`git push -u origin ${branchName}`, { cwd: repoPath });

      let prUrl: string | undefined;

      // Create PR if requested
      if (createPr) {
        console.log(`[Completion] Creating pull request...`);
        const pr = await this.octokit.rest.pulls.create({
          owner: ticket.repo.owner,
          repo: ticket.repo.name,
          title: ticket.title,
          head: branchName,
          base: "main", // or detect default branch
          body: this.generatePrBody(ticket, summary, filesChanged),
        });
        prUrl = pr.data.html_url;
        console.log(`[Completion] PR created: ${prUrl}`);
      }

      return {
        success: true,
        branch: branchName,
        commitHash,
        prUrl,
        summary,
        filesChanged,
      };

    } catch (error) {
      console.error("[Completion] Failed:", error);
      return {
        success: false,
        branch: branchName,
        summary: `Failed: ${error}`,
        filesChanged: [],
      };
    }
  }

  /**
   * Generate branch name from ticket
   */
  private generateBranchName(ticket: AgentContext["ticket"]): string {
    const sanitized = ticket.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    
    return `agent/${ticket.id}-${sanitized}`;
  }

  /**
   * Generate commit message
   */
  private generateCommitMessage(ticket: AgentContext["ticket"], summary: string): string {
    const shortSummary = summary.slice(0, 100).replace(/"/g, '\\"');
    return `[Agent] #${ticket.number}: ${shortSummary}`;
  }

  /**
   * Generate PR body
   */
  private generatePrBody(
    ticket: AgentContext["ticket"],
    summary: string,
    filesChanged: string[]
  ): string {
    return `## Summary
${summary}

## Ticket
Closes #${ticket.number}

## Changes
${filesChanged.map(f => `- \`${f}\``).join("\n")}

## Agent
- Type: ${ticket.agentType}
- Ticket: ${ticket.title}

---
*This PR was created by Xcode Agent Runner* 🤖
`;
  }
}