import { Octokit } from "@octokit/rest";
import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

type GitTransportMode = "ssh" | "https";

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

function toGithubSshUrl(owner: string, repo: string): string {
  return `git@github.com:${owner}/${repo}.git`;
}

function looksLikeGithubRepo(url: string): boolean {
  return /(^git@github\.com:)|(^https:\/\/github\.com\/)/i.test(url);
}

export class AgentEnvironment {
  private octokit: Octokit;
  private workspaceBase: string;
  private secretsBase: string;
  private gitTransport: GitTransportMode;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
    this.workspaceBase = process.env.WORKSPACE_BASE || "/tmp/agent-work";
    this.secretsBase = process.env.SECRETS_BASE || path.join(os.homedir(), ".agent-secrets");
    this.gitTransport = this.resolveGitTransport();
  }

  private resolveGitTransport(): GitTransportMode {
    const value = (process.env.GITHUB_GIT_TRANSPORT || "ssh").trim().toLowerCase();
    return value === "https" ? "https" : "ssh";
  }

  private getCloneUrl(ticket: Pick<Ticket, "repo">): string {
    if (this.gitTransport === "ssh" && looksLikeGithubRepo(ticket.repo.cloneUrl)) {
      return toGithubSshUrl(ticket.repo.owner, ticket.repo.name);
    }
    return ticket.repo.cloneUrl;
  }

  private verifyGitPushAccess(repoPath: string): void {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();

    if (!looksLikeGithubRepo(remoteUrl)) {
      return;
    }

    if (remoteUrl.startsWith("git@github.com:")) {
      console.log(`[Setup] Verifying GitHub SSH push access...`);
      execSync("ssh -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new git@github.com || true", {
        cwd: repoPath,
        stdio: "inherit",
      });
    } else {
      console.log(`[Setup] Skipping SSH push access check for non-SSH remote: ${remoteUrl}`);
    }
  }

  /**
   * Fetch ticket details from GitHub issue
   */
  async fetchTicket(owner: string, repo: string, issueNumber: number): Promise<Ticket> {
    const { data: issue } = await this.octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    // Determine agent type from labels
    const agentLabel = issue.labels.find((l: any) => {
      const labelName = typeof l === "string" ? l : l.name;
      return labelName === "agent:opus" || labelName === "agent:sonnet";
    });
    const agentType = (typeof agentLabel === "string" 
      ? agentLabel 
      : agentLabel?.name
    )?.replace("agent:", "") as "opus" | "sonnet" || "sonnet";

    const { data: repository } = await this.octokit.rest.repos.get({
      owner,
      repo,
    });

    return {
      id: `${owner}-${repo}-${issueNumber}`,
      number: issueNumber,
      title: issue.title,
      body: issue.body || "",
      agentType,
      repo: {
        owner,
        name: repo,
        cloneUrl: repository.clone_url,
      },
    };
  }

  /**
   * Setup workspace for agent execution
   */
  async setupWorkspace(ticket: Ticket): Promise<AgentContext> {
    const workspacePath = path.join(this.workspaceBase, ticket.id);
    const secretsPath = path.join(this.secretsBase, `${ticket.repo.owner}-${ticket.repo.name}`);
    const inputFilePath = path.join(workspacePath, "input");
    const repoPath = path.join(workspacePath, "repo");

    // Reset workspace so repeated runs for the same ticket don't fail on stale clones
    await fs.rm(workspacePath, { recursive: true, force: true });
    await fs.mkdir(workspacePath, { recursive: true });

    // Create input file for bidirectional communication
    await fs.writeFile(inputFilePath, "", { flag: "w" });

    // Clone repository
    const cloneUrl = this.getCloneUrl(ticket);
    console.log(`[Setup] Cloning ${cloneUrl} (transport: ${this.gitTransport})...`);
    execSync(`git clone ${cloneUrl} "${repoPath}"`, {
      stdio: "inherit",
    });
    this.verifyGitPushAccess(repoPath);

    // Copy .env from secrets if exists
    const envSource = path.join(secretsPath, "env");
    const envDest = path.join(repoPath, ".env");
    try {
      await fs.copyFile(envSource, envDest);
      console.log(`[Setup] Copied .env from secrets`);
    } catch {
      console.log(`[Setup] No .env found in secrets, skipping`);
    }

    // Resolve package dependencies
    console.log(`[Setup] Resolving package dependencies...`);
    try {
      execSync("xcodebuild -resolvePackageDependencies", {
        cwd: repoPath,
        stdio: "inherit",
      });
    } catch (error) {
      console.warn(`[Setup] Package resolution had issues, continuing...`);
    }

    return {
      ticket,
      workspacePath,
      secretsPath,
      inputFilePath,
      repoPath,
    };
  }

  /**
   * Verify project builds
   */
  async verifyBuild(repoPath: string): Promise<{ success: boolean; output: string }> {
    console.log(`[Setup] Verifying project builds...`);
    try {
      const output = execSync("xcodebuild -scheme $(basename $(pwd)) build", {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 300000, // 5 minutes
      });
      return { success: true, output };
    } catch (error: any) {
      return { success: false, output: error.stdout || error.message };
    }
  }

  /**
   * Clean up workspace
   */
  async cleanup(workspacePath: string): Promise<void> {
    console.log(`[Cleanup] Removing workspace: ${workspacePath}`);
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      console.error(`[Cleanup] Failed to remove workspace:`, error);
    }
  }
}