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
import { createRateLimitMiddleware, createAuthRateLimitMiddleware } from "./middleware/rate-limit.js";
import { createSecurityHeadersMiddleware, createDevSecurityHeadersMiddleware } from "./middleware/security-headers.js";
import { createRequestLoggerMiddleware, ConsoleLogger } from "./middleware/logging.js";
import { createErrorHandlerMiddleware, createNotFoundHandler, asyncHandler, HTTPError, Errors } from "./middleware/error-handler.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3800;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const BRIDGE_PORT = parseInt(process.env.BRIDGE_WS_PORT || "9300", 10);
const BEARER_TOKEN = process.env.BEARER_TOKEN || "";
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

// Logger
const logger = new ConsoleLogger(isProduction ? "info" : "debug");

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

// Global middleware - order matters!
// 1. Security headers first
app.use(isProduction ? createSecurityHeadersMiddleware() : createDevSecurityHeadersMiddleware());

// 2. CORS
app.use(createCORSMiddleware(corsConfig));

// 3. Request logging (skip health checks to reduce noise)
app.use(createRequestLoggerMiddleware({
  logger,
  skipPaths: ["/health", "/api/health"],
}));

// 4. Body parsing with webhook signature verification
app.use(express.json({ verify: verifyWebhookSignature }));

// 5. Rate limiting for all routes
app.use(createRateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
}));

// 6. Auth middleware (optional for most routes, can be made required per-route)
const optionalAuth = createOptionalAuthMiddleware(authConfig);
const requireAuth = createAuthMiddleware(authConfig);
app.use(optionalAuth);

/**
 * Verify GitHub webhook signature
 * Throws HTTPError with 401 status if signature is invalid
 */
function verifyWebhookSignature(req: Request, res: Response, buf: Buffer): void {
  const signature = req.headers["x-hub-signature-256"] as string;
  if (!signature || !WEBHOOK_SECRET) return;

  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(buf).digest("hex");

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      throw Errors.unauthorized("Invalid webhook signature");
    }
  } catch (error) {
    // Handle case where signature and digest have different lengths
    // or other crypto.timingSafeEqual errors
    if (error instanceof HTTPError) {
      throw error;
    }
    throw Errors.unauthorized("Invalid webhook signature format");
  }
}

/**
 * Health check endpoints
 */
// New API health endpoint at /api/health
app.use("/api", createHealthRouter());

// Legacy health endpoint (for backward compatibility)
app.get("/health", createLegacyHealthHandler());

/**
 * GitHub webhook endpoint
 * Stricter rate limit to prevent abuse
 */
app.post(
  "/webhook/github",
  createAuthRateLimitMiddleware(),
  asyncHandler(async (req: Request, res: Response) => {
    const event = req.headers["x-github-event"] as string;
    const payload = req.body;

    logger.info(`Received GitHub event: ${event}`, {
      requestId: (req as any).requestId,
    });

    // Handle issue events with agent labels
    if (event === "issues" && payload.action === "labeled") {
      const label = payload.label?.name;

      if (label === "agent:opus" || label === "agent:sonnet") {
        const { repository, issue } = payload;

        logger.info(`Agent label detected: ${label} on issue #${issue.number}`, {
          requestId: (req as any).requestId,
        });

        // Start agent asynchronously
        startAgent(
          repository.owner.login,
          repository.name,
          issue.number
        ).catch(error => {
          logger.error("Failed to start agent", error, {
            requestId: (req as any).requestId,
          });
        });

        res.status(202).json({
          status: "accepted",
          message: `Agent (${label}) starting for issue #${issue.number}`,
        });
        return;
      }
    }

    res.status(200).json({ status: "ignored" });
  })
);

/**
 * Manual trigger endpoint
 * Requires authentication for non-loopback requests
 */
app.post(
  "/trigger",
  requireAuth,
  createAuthRateLimitMiddleware(),
  asyncHandler(async (req: Request, res: Response) => {
    const { owner, repo, issue, agentType = "sonnet" } = req.body;

    if (!owner || !repo || !issue) {
      res.status(400).json({
        error: "Missing required fields: owner, repo, issue",
      });
      return;
    }

    logger.info(`Manual trigger for ${owner}/${repo}#${issue} (${agentType})`, {
      requestId: (req as any).requestId,
    });

    const ticketId = `${owner}-${repo}-${parseInt(issue, 10)}`;

    bridge.broadcast({
      type: "output",
      content: `Trigger accepted for ${ticketId}`,
      timestamp: Date.now(),
      metadata: {
        ticketId,
        ticketNumber: parseInt(issue, 10),
        stage: "trigger_accepted",
      },
    });

    // Start agent asynchronously
    startAgent(owner, repo, parseInt(issue, 10), agentType as "opus" | "sonnet")
      .catch(error => {
        logger.error("Failed to start agent", error, {
          requestId: (req as any).requestId,
        });
      });

    res.status(202).json({
      status: "accepted",
      message: `Agent (${agentType}) starting for ${owner}/${repo}#${issue}`,
    });
  })
);

/**
 * List active agents
 * Requires authentication for non-loopback requests
 */
app.get("/agents", requireAuth, (req: Request, res: Response) => {
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
    logger.info(`Agent already running for ${ticketId}`);
    return;
  }

  try {
    // Fetch ticket details
    const ticket = await environment.fetchTicket(owner, repo, issueNumber);

    // Override agent type if specified
    if (agentType) {
      ticket.agentType = agentType;
    }

    logger.info(`Setting up workspace for ${ticketId}...`);

    // Setup workspace
    const context = await environment.setupWorkspace(ticket);

    // Create worker
    const worker = new AgentWorker(context);

    // Forward messages to bridge
    worker.on("message", (message: AgentMessage) => {
      try {
        bridge.broadcast({
          ...message,
          metadata: {
            ...message.metadata,
            ticketId,
            ticketNumber: ticket.number,
          },
        });
      } catch (error) {
        logger.error(`Failed to broadcast message for ${ticketId}`, error);
      }
    });

    // Handle completion
    worker.on("complete", async () => {
      logger.info(`Agent completed for ${ticketId}`);
      activeWorkers.delete(ticketId);

      // Cleanup workspace (optional - can be disabled for debugging)
      // await environment.cleanup(context.workspacePath);
    });

    // Store and start
    activeWorkers.set(ticketId, worker);
    await worker.start();

  } catch (error) {
    logger.error(`Failed to start agent for ${ticketId}`, error);
    activeWorkers.delete(ticketId);
    throw error;
  }
}

/**
 * Handle commands from bridge
 */
bridge.on("command", (cmd: { command: string; target?: string }) => {
  try {
    if (cmd.target && activeWorkers.has(cmd.target)) {
      const worker = activeWorkers.get(cmd.target)!;
      worker.sendToAgent(cmd.command);
    } else if (!cmd.target) {
      // Broadcast to all if no target
      for (const [id, worker] of activeWorkers) {
        try {
          worker.sendToAgent(cmd.command);
        } catch (error) {
          logger.error(`Failed to send command to worker ${id}`, error);
        }
      }
    } else {
      logger.warn(`Command target not found: ${cmd.target}`);
    }
  } catch (error) {
    logger.error("Error handling bridge command", error);
  }
});

// 404 handler - must be after all routes
app.use(createNotFoundHandler({ logger }));

// Error handler - must be last
app.use(createErrorHandlerMiddleware({
  logger,
  includeStack: !isProduction,
}));

// Start server
app.listen(PORT, () => {
  logger.info(`HTTP server listening on port ${PORT}`);
  logger.info(`WebSocket bridge on port ${BRIDGE_PORT}`);
  logger.info(`Ready for GitHub webhooks at /webhook/github`);
  logger.info(`Manual trigger at POST /trigger`);
  logger.info(`Health check at GET /api/health`);
  logger.info(`Auth: ${authConfig.bearerToken ? "Bearer token required for non-loopback" : "No bearer token configured"}`);
  logger.info(`Local unauthenticated access: ${authConfig.allowLocalUnauthenticated ? "allowed" : "denied"}`);
  logger.info(`Environment: ${NODE_ENV}`);
});
