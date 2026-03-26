import express, { Request, Response } from "express";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { AgentEnvironment } from "./environment.js";
import { AgentWorker } from "./worker.js";
import { AgentBridge } from "./bridge.js";
import { AgentMessage } from "./worker.js";
import { createAuthMiddleware, createOptionalAuthMiddleware } from "./middleware/auth.js";
import { createCORSMiddleware } from "./middleware/cors.js";
import { createHealthRouter, createLegacyHealthHandler } from "./routes/health.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3800;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const BRIDGE_PORT = parseInt(process.env.BRIDGE_WS_PORT || "9300", 10);
const BEARER_TOKEN = process.env.BEARER_TOKEN || "";

// Auth configuration
const authConfig = {
  bearerToken: BEARER_TOKEN || undefined,
  allowLocalUnauthenticated: process.env.ALLOW_LOCAL_UNAUTHENTICATED !== "false", // default true
};

// CORS configuration
const corsConfig = {
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || ["*"],
  allowCredentials: true,
};

// Track active workers
const activeWorkers = new Map<string, AgentWorker>();

// Initialize bridge
const bridge = new AgentBridge({ port: BRIDGE_PORT });

// Initialize environment
const environment = new AgentEnvironment(GITHUB_TOKEN);

// Global middleware
app.use(createCORSMiddleware(corsConfig));
app.use(express.json({ verify: verifyWebhookSignature }));

// Auth middleware (optional for most routes, can be made required per-route)
const optionalAuth = createOptionalAuthMiddleware(authConfig);
const requireAuth = createAuthMiddleware(authConfig);
app.use(optionalAuth);

/**
 * Verify GitHub webhook signature
 */
function verifyWebhookSignature(req: Request, res: Response, buf: Buffer): void {
  const signature = req.headers["x-hub-signature-256"] as string;
  if (!signature || !WEBHOOK_SECRET) return;

  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(buf).digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    throw new Error("Invalid webhook signature");
  }
}

/**
 * GitHub webhook endpoint
 */
app.post("/webhook/github", async (req: Request, res: Response) => {
  try {
    const event = req.headers["x-github-event"] as string;
    const payload = req.body;

    console.log(`[Router] Received GitHub event: ${event}`);

    // Handle issue events with agent labels
    if (event === "issues" && payload.action === "labeled") {
      const label = payload.label?.name;
      
      if (label === "agent:opus" || label === "agent:sonnet") {
        const { repository, issue } = payload;
        
        console.log(`[Router] Agent label detected: ${label} on issue #${issue.number}`);
        
        // Start agent asynchronously
        startAgent(
          repository.owner.login,
          repository.name,
          issue.number
        ).catch(error => {
          console.error("[Router] Failed to start agent:", error);
        });

        res.status(202).json({ 
          status: "accepted", 
          message: `Agent (${label}) starting for issue #${issue.number}` 
        });
        return;
      }
    }

    res.status(200).json({ status: "ignored" });
  } catch (error) {
    console.error("[Router] Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Manual trigger endpoint
 */
app.post("/trigger", async (req: Request, res: Response) => {
  try {
    const { owner, repo, issue, agentType = "sonnet" } = req.body;

    if (!owner || !repo || !issue) {
      res.status(400).json({ 
        error: "Missing required fields: owner, repo, issue" 
      });
      return;
    }

    console.log(`[Router] Manual trigger for ${owner}/${repo}#${issue} (${agentType})`);

    // Start agent asynchronously
    startAgent(owner, repo, parseInt(issue, 10), agentType as "opus" | "sonnet")
      .catch(error => {
        console.error("[Router] Failed to start agent:", error);
      });

    res.status(202).json({ 
      status: "accepted", 
      message: `Agent (${agentType}) starting for ${owner}/${repo}#${issue}` 
    });
  } catch (error) {
    console.error("[Router] Trigger error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Health check endpoints
 */
// New API health endpoint at /api/health
app.use("/api", createHealthRouter());

// Legacy health endpoint (for backward compatibility)
app.get("/health", createLegacyHealthHandler());

/**
 * List active agents
 */
app.get("/agents", (req: Request, res: Response) => {
  const agents = Array.from(activeWorkers.keys()).map(id => ({
    id,
    status: "running",
  }));
  
  res.json({ agents });
});

/**
 * Start agent for a ticket
 */
async function startAgent(
  owner: string, 
  repo: string, 
  issueNumber: number,
  agentType?: "opus" | "sonnet"
): Promise<void> {
  const ticketId = `${owner}-${repo}-${issueNumber}`;
  
  // Check if already running
  if (activeWorkers.has(ticketId)) {
    console.log(`[Router] Agent already running for ${ticketId}`);
    return;
  }

  try {
    // Fetch ticket details
    const ticket = await environment.fetchTicket(owner, repo, issueNumber);
    
    // Override agent type if specified
    if (agentType) {
      ticket.agentType = agentType;
    }

    console.log(`[Router] Setting up workspace for ${ticketId}...`);
    
    // Setup workspace
    const context = await environment.setupWorkspace(ticket);
    
    // Create worker
    const worker = new AgentWorker(context);
    
    // Forward messages to bridge
    worker.on("message", (message: AgentMessage) => {
      bridge.broadcast({
        ...message,
        metadata: {
          ...message.metadata,
          ticketId,
          ticketNumber: ticket.number,
        },
      });
    });

    // Handle completion
    worker.on("complete", async () => {
      console.log(`[Router] Agent completed for ${ticketId}`);
      activeWorkers.delete(ticketId);
      
      // Cleanup workspace (optional - can be disabled for debugging)
      // await environment.cleanup(context.workspacePath);
    });

    // Store and start
    activeWorkers.set(ticketId, worker);
    await worker.start();
    
  } catch (error) {
    console.error(`[Router] Failed to start agent for ${ticketId}:`, error);
    activeWorkers.delete(ticketId);
    throw error;
  }
}

/**
 * Handle commands from bridge
 */
bridge.on("command", (cmd: { command: string; target?: string }) => {
  if (cmd.target && activeWorkers.has(cmd.target)) {
    const worker = activeWorkers.get(cmd.target)!;
    worker.sendToAgent(cmd.command);
  } else {
    // Broadcast to all if no target
    for (const [id, worker] of activeWorkers) {
      worker.sendToAgent(cmd.command);
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[Router] HTTP server listening on port ${PORT}`);
  console.log(`[Router] WebSocket bridge on port ${BRIDGE_PORT}`);
  console.log(`[Router] Ready for GitHub webhooks at /webhook/github`);
  console.log(`[Router] Manual trigger at POST /trigger`);
  console.log(`[Router] Health check at GET /api/health`);
  console.log(`[Router] Auth: ${authConfig.bearerToken ? "Bearer token required for non-loopback" : "No bearer token configured"}`);
  console.log(`[Router] Local unauthenticated access: ${authConfig.allowLocalUnauthenticated ? "allowed" : "denied"}`);
});