import { Router, Request, Response } from "express";
import { PROTOCOL_VERSION } from "../middleware/auth.js";

/**
 * Get package version from package.json
 */
function getVersion(): string {
  try {
    // In development (tsx), import.meta.url points to the source file
    // In production, we need to resolve from the compiled output
    const pkg = (global as any).__packageJson || { version: "1.0.0" };
    return pkg.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

/**
 * Health check response structure
 */
export interface HealthResponse {
  /** Always "ok" when the service is healthy */
  status: "ok";
  /** Server version (from package.json) */
  version: string;
  /** Protocol version for API compatibility checking */
  protocolVersion: number;
  /** ISO 8601 timestamp of the response */
  timestamp: string;
}

/**
 * Create health check router
 */
export function createHealthRouter(): Router {
  const router = Router();

  /**
   * GET /api/health
   *
   * Health check endpoint for discovery and connectivity testing.
   * Returns server status, version info, and protocol version.
   *
   * This endpoint is typically unauthenticated to allow discovery probes,
   * but may be protected depending on deployment requirements.
   */
  router.get("/health", (req: Request, res: Response) => {
    const response: HealthResponse = {
      status: "ok",
      version: getVersion(),
      protocolVersion: PROTOCOL_VERSION,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  });

  return router;
}

/**
 * Legacy health endpoint (for backward compatibility)
 * @deprecated Use /api/health instead
 */
export function createLegacyHealthHandler() {
  return (req: Request, res: Response) => {
    const response: HealthResponse = {
      status: "ok",
      version: getVersion(),
      protocolVersion: PROTOCOL_VERSION,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  };
}
