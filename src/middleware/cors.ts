import { Request, Response, NextFunction } from "express";

/**
 * CORS middleware configuration options
 */
export interface CORSConfig {
  /** Allowed origins. Use ["*"] to allow all, or specific origins like ["http://localhost:3000"] */
  allowedOrigins: string[];
  /** Allowed HTTP methods */
  allowedMethods: string[];
  /** Allowed headers */
  allowedHeaders: string[];
  /** Whether to allow credentials (cookies, authorization headers) */
  allowCredentials: boolean;
  /** Max age for preflight cache in seconds */
  maxAge: number;
}

/**
 * Default CORS configuration
 * Allows common development origins and all production origins
 */
export const defaultCORSConfig: CORSConfig = {
  allowedOrigins: ["*"],
  allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "X-GitHub-Event",
    "X-Hub-Signature-256",
  ],
  allowCredentials: true,
  maxAge: 86400, // 24 hours
};

/**
 * Create CORS middleware
 *
 * Handles:
 * - Origin validation
 * - Preflight (OPTIONS) requests
 * - Credential support
 * - Custom headers for webhooks
 */
export function createCORSMiddleware(config: Partial<CORSConfig> = {}) {
  const fullConfig: CORSConfig = { ...defaultCORSConfig, ...config };

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // Determine if origin is allowed
    let allowOrigin = false;
    if (fullConfig.allowedOrigins.includes("*")) {
      allowOrigin = true;
      // When allowing all origins with credentials, we must echo the actual origin
      if (fullConfig.allowCredentials && origin) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Access-Control-Allow-Credentials", "true");
      } else {
        res.header("Access-Control-Allow-Origin", "*");
      }
    } else if (origin && fullConfig.allowedOrigins.includes(origin)) {
      allowOrigin = true;
      res.header("Access-Control-Allow-Origin", origin);
      if (fullConfig.allowCredentials) {
        res.header("Access-Control-Allow-Credentials", "true");
      }
    }

    // Always set these headers for allowed origins
    if (allowOrigin) {
      res.header(
        "Access-Control-Allow-Methods",
        fullConfig.allowedMethods.join(", ")
      );
      res.header(
        "Access-Control-Allow-Headers",
        fullConfig.allowedHeaders.join(", ")
      );
      res.header("Access-Control-Max-Age", fullConfig.maxAge.toString());

      // Expose headers that the client may need to read
      res.header(
        "Access-Control-Expose-Headers",
        ["Content-Length", "Content-Type", "X-Protocol-Version"].join(", ")
      );
    }

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.status(204).send();
      return;
    }

    next();
  };
}

/**
 * Simple CORS middleware that allows all origins
 * Useful for development and internal networks
 */
export function allowAllCORS() {
  return createCORSMiddleware({
    allowedOrigins: ["*"],
    allowCredentials: false, // Cannot use credentials with wildcard origin
  });
}
