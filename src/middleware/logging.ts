import { Request, Response, NextFunction } from "express";

/**
 * Log level
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  error?: Error | unknown;
  [key: string]: unknown;
}

/**
 * Logger interface
 */
export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, error?: Error | unknown, meta?: Record<string, unknown>) => void;
}

/**
 * Console logger implementation
 */
export class ConsoleLogger implements Logger {
  constructor(private minLevel: LogLevel = "info") {}

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private format(entry: LogEntry): string {
    const base = `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`;
    const meta = Object.entries(entry)
      .filter(([key]) => !["timestamp", "level", "message"].includes(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ");
    return meta ? `${base} ${meta}` : base;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog("debug")) return;
    console.debug(this.format({ timestamp: new Date().toISOString(), level: "debug", message, ...meta }));
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog("info")) return;
    console.info(this.format({ timestamp: new Date().toISOString(), level: "info", message, ...meta }));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog("warn")) return;
    console.warn(this.format({ timestamp: new Date().toISOString(), level: "warn", message, ...meta }));
  }

  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    if (!this.shouldLog("error")) return;
    const errorMeta = error instanceof Error
      ? { error: error.message, stack: error.stack }
      : { error };
    console.error(this.format({
      timestamp: new Date().toISOString(),
      level: "error",
      message,
      ...errorMeta,
      ...meta,
    }));
  }
}

/**
 * Request logging configuration
 */
export interface RequestLoggerConfig {
  /** Logger instance to use */
  logger?: Logger;
  /** Log level for successful requests */
  successLevel?: LogLevel;
  /** Log level for error responses (>=400) */
  errorLevel?: LogLevel;
  /** Generate request ID for tracing */
  generateRequestId?: boolean;
  /** Skip logging for certain paths (e.g., health checks) */
  skipPaths?: string[];
  /** Include request body in logs (be careful with sensitive data) */
  includeBody?: boolean;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create request logging middleware
 *
 * Logs all HTTP requests with structured data including:
 * - Method, path, status code
 * - Response time
 * - Client IP
 * - User agent
 * - Request ID for tracing
 *
 * @example
 * app.use(createRequestLoggerMiddleware());
 *
 * // Skip health checks
 * app.use(createRequestLoggerMiddleware({ skipPaths: ["/health", "/api/health"] }));
 */
export function createRequestLoggerMiddleware(config: RequestLoggerConfig = {}) {
  const {
    logger = new ConsoleLogger(),
    successLevel = "info",
    errorLevel = "warn",
    generateRequestId: genReqId = true,
    skipPaths = [],
    includeBody = false,
  } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip if path matches
    if (skipPaths.some(path => req.path === path || req.path.startsWith(path))) {
      return next();
    }

    const startTime = Date.now();
    const requestId = genReqId ? generateRequestId() : undefined;

    // Attach request ID to request for use in other middleware/handlers
    if (requestId) {
      (req as any).requestId = requestId;
      res.setHeader("X-Request-Id", requestId);
    }

    // Log request start in debug mode
    logger.debug("Request started", {
      method: req.method,
      path: req.path,
      ip: req.socket?.remoteAddress || req.ip,
      userAgent: req.get("user-agent"),
      requestId,
      ...(includeBody && req.body ? { body: sanitizeBody(req.body) } : {}),
    });

    // Capture response finish
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      const level = res.statusCode >= 400 ? errorLevel : successLevel;
      const message = `${req.method} ${req.path} ${res.statusCode}`;

      const meta = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
        ip: req.socket?.remoteAddress || req.ip,
        userAgent: req.get("user-agent"),
        requestId,
      };

      if (level === "error") {
        logger.error(message, undefined, meta);
      } else if (level === "warn") {
        logger.warn(message, meta);
      } else if (level === "debug") {
        logger.debug(message, meta);
      } else {
        logger.info(message, meta);
      }
    });

    next();
  };
}

/**
 * Sanitize request body for logging
 * Removes sensitive fields like passwords, tokens, etc.
 */
function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ["password", "token", "secret", "authorization", "api_key", "apikey"];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeBody(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Get request ID from request object
 */
export function getRequestId(req: Request): string | undefined {
  return (req as any).requestId;
}
