import { Router, Request, Response } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PROTOCOL_VERSION } from "../middleware/auth.js";

// Cache for package.json to avoid repeated reads
let cachedVersion: string | null = null;

/**
 * Get package version from package.json
 * Tries multiple resolution strategies for development and production
 */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    // Strategy 1: Try to read from current working directory
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    cachedVersion = pkg.version;
    return cachedVersion || "1.0.0";
  } catch {
    // Strategy 2: Try to resolve relative to this module
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
      cachedVersion = pkg.version;
      return cachedVersion || "1.0.0";
    } catch {
      // Fallback to environment variable or default
      cachedVersion = process.env.npm_package_version || "1.0.0";
      return cachedVersion;
    }
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
