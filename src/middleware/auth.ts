import { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";

/**
 * Protocol version for API compatibility
 * Increment when making breaking changes to the API
 */
export const PROTOCOL_VERSION = 1;

/**
 * Get the actual peer IP address from the socket connection
 * This is the CORRECT way to detect loopback - using the actual peer IP,
 * not the Host header which can be spoofed.
 */
export function getPeerIP(req: Request): string {
  // Check for X-Forwarded-For header (when behind a proxy)
  // Only trust this if the immediate connection is from a known proxy/loopback
  const forwarded = req.headers["x-forwarded-for"];
  const immediatePeer = req.socket.remoteAddress;

  // If the immediate peer is loopback or a trusted proxy, we can check X-Forwarded-For
  if (isLoopbackAddress(immediatePeer || "")) {
    if (typeof forwarded === "string") {
      // X-Forwarded-For can be a comma-separated list; use the first (client) IP
      return forwarded.split(",")[0].trim();
    }
  }

  // Otherwise, use the actual socket peer address
  return immediatePeer || "";
}

/**
 * Check if an IP address is loopback
 * Handles IPv4 (127.x.x.x) and IPv6 (::1)
 */
export function isLoopbackAddress(ip: string): boolean {
  if (!ip) return false;

  // Normalize the IP
  const normalized = ip.toLowerCase().trim();

  // IPv4 loopback: 127.0.0.0/8
  if (normalized.startsWith("127.")) {
    return true;
  }

  // IPv6 loopback: ::1
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  // Handle IPv6-mapped IPv4 (::ffff:127.x.x.x)
  if (normalized.startsWith("::ffff:127.")) {
    return true;
  }

  return false;
}

/**
 * Configuration for auth middleware
 */
export interface AuthConfig {
  /** Bearer token for authentication. If not provided, no auth required */
  bearerToken?: string;
  /** Whether to allow loopback connections without authentication */
  allowLocalUnauthenticated: boolean;
}

/**
 * Extract bearer token from Authorization header
 * Format: "Bearer <token>"
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;

  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Extract token from query parameter (for WebSocket connections)
 */
export function extractTokenFromQuery(req: Request): string | null {
  const token = req.query.token;
  if (typeof token === "string") return token;
  return null;
}

/**
 * Create Express middleware for bearer token authentication
 *
 * Security model:
 * - Loopback connections (127.x.x.x, ::1) can bypass auth if allowLocalUnauthenticated is true
 * - Non-loopback connections always require a valid bearer token
 * - The peer IP is determined from the socket, NOT the Host header (prevents spoofing)
 */
export function createAuthMiddleware(config: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Get the actual peer IP (not the Host header)
    const peerIP = getPeerIP(req);

    // Check if this is a loopback connection
    const isLoopback = isLoopbackAddress(peerIP);

    // Allow loopback without auth if configured
    if (isLoopback && config.allowLocalUnauthenticated) {
      (req as any).auth = { type: "loopback", ip: peerIP };
      return next();
    }

    // Non-loopback or auth required - check bearer token
    const token = extractBearerToken(req) || extractTokenFromQuery(req);

    if (!token) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required. Provide a Bearer token via Authorization header or ?token query parameter.",
      });
      return;
    }

    // Validate token using timing-safe comparison
    const expectedToken = config.bearerToken;
    if (!expectedToken) {
      res.status(401).json({
        error: "Unauthorized",
        message: "No bearer token configured on server.",
      });
      return;
    }

    // Use timing-safe comparison to prevent timing attacks
    // timingSafeEqual throws if buffers have different lengths, which we catch as invalid
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(expectedToken)
      );

      if (!isValid) {
        res.status(401).json({
          error: "Unauthorized",
          message: "Invalid bearer token.",
        });
        return;
      }
    } catch {
      // Buffer length mismatch - token is invalid
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid bearer token.",
      });
      return;
    }

    // Token is valid
    (req as any).auth = { type: "bearer", ip: peerIP };
    next();
  };
}

/**
 * Optional auth middleware that attaches auth info but doesn't reject requests
 * Useful for endpoints that want to know if user is authenticated but don't require it
 */
export function createOptionalAuthMiddleware(config: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const peerIP = getPeerIP(req);
    const isLoopback = isLoopbackAddress(peerIP);
    const token = extractBearerToken(req) || extractTokenFromQuery(req);

    let authType: string;

    if (isLoopback && config.allowLocalUnauthenticated) {
      authType = "loopback";
    } else if (token && config.bearerToken) {
      // Use timing-safe comparison to prevent timing attacks
      // timingSafeEqual throws if buffers have different lengths, which we treat as invalid
      try {
        const isValid = crypto.timingSafeEqual(
          Buffer.from(token),
          Buffer.from(config.bearerToken)
        );
        authType = isValid ? "bearer" : "invalid";
      } catch {
        // Buffer length mismatch - token is invalid
        authType = "invalid";
      }
    } else {
      authType = "none";
    }

    (req as any).auth = { type: authType, ip: peerIP };
    next();
  };
}
