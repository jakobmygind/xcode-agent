import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { Logger, ConsoleLogger } from "./logging.js";

/**
 * HTTP error with status code
 */
export class HTTPError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "HTTPError";
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Common HTTP errors
 */
export const Errors = {
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new HTTPError(400, message, "BAD_REQUEST", details),

  unauthorized: (message = "Unauthorized") =>
    new HTTPError(401, message, "UNAUTHORIZED"),

  forbidden: (message = "Forbidden") =>
    new HTTPError(403, message, "FORBIDDEN"),

  notFound: (resource: string) =>
    new HTTPError(404, `${resource} not found`, "NOT_FOUND"),

  conflict: (message: string) =>
    new HTTPError(409, message, "CONFLICT"),

  tooManyRequests: (message = "Too many requests") =>
    new HTTPError(429, message, "TOO_MANY_REQUESTS"),

  internal: (message = "Internal server error") =>
    new HTTPError(500, message, "INTERNAL_ERROR"),

  notImplemented: (feature: string) =>
    new HTTPError(501, `${feature} not implemented`, "NOT_IMPLEMENTED"),

  badGateway: (message = "Bad gateway") =>
    new HTTPError(502, message, "BAD_GATEWAY"),

  serviceUnavailable: (message = "Service unavailable") =>
    new HTTPError(503, message, "SERVICE_UNAVAILABLE"),
};

/**
 * Error response structure
 */
export interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    status: number;
    details?: Record<string, unknown>;
    requestId?: string;
    stack?: string;
  };
}

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  /** Logger instance */
  logger?: Logger;
  /** Include stack trace in error response (development only) */
  includeStack?: boolean;
  /** Include request ID in error response */
  includeRequestId?: boolean;
  /** Callback for custom error handling/reporting */
  onError?: (error: Error, req: Request, res: Response) => void;
}

/**
 * Create error handling middleware
 *
 * Catches all errors and returns consistent JSON error responses.
 * Handles both HTTPError instances and unexpected errors.
 *
 * @example
 * // Add after all routes
 * app.use(createErrorHandlerMiddleware());
 *
 * // In development, include stack traces
 * app.use(createErrorHandlerMiddleware({ includeStack: true }));
 */
export function createErrorHandlerMiddleware(config: ErrorHandlerConfig = {}): ErrorRequestHandler {
  const {
    logger = new ConsoleLogger(),
    includeStack = process.env.NODE_ENV === "development",
    includeRequestId = true,
    onError,
  } = config;

  return (err: Error, req: Request, res: Response, _next: NextFunction): void => {
    // Determine if this is an HTTP error
    const isHTTPError = err instanceof HTTPError;
    const statusCode = isHTTPError ? (err as HTTPError).statusCode : 500;
    const errorCode = isHTTPError ? (err as HTTPError).code : "INTERNAL_ERROR";
    const details = isHTTPError ? (err as HTTPError).details : undefined;

    // Get request ID if available
    const requestId = includeRequestId ? (req as any).requestId : undefined;

    // Log the error
    if (statusCode >= 500) {
      logger.error("Server error", err, {
        method: req.method,
        path: req.path,
        statusCode,
        requestId,
        ip: req.socket?.remoteAddress || req.ip,
      });
    } else {
      logger.warn("Client error", {
        message: err.message,
        statusCode,
        code: errorCode,
        method: req.method,
        path: req.path,
        requestId,
        ip: req.socket?.remoteAddress || req.ip,
      });
    }

    // Custom error callback
    if (onError) {
      try {
        onError(err, req, res);
      } catch (callbackError) {
        logger.error("Error in onError callback", callbackError);
      }
    }

    // Build error response
    const errorResponse: ErrorResponse = {
      error: {
        message: err.message || "An unexpected error occurred",
        code: errorCode,
        status: statusCode,
        ...(details && { details }),
        ...(requestId && { requestId }),
        ...(includeStack && { stack: err.stack }),
      },
    };

    // Send response
    if (!res.headersSent) {
      res.status(statusCode).json(errorResponse);
    }
  };
}

/**
 * Create 404 not found handler
 * Should be added after all valid routes
 */
export function createNotFoundHandler(config: { logger?: Logger } = {}) {
  const { logger = new ConsoleLogger() } = config;

  return (req: Request, res: Response): void => {
    const requestId = (req as any).requestId;

    logger.warn("Route not found", {
      method: req.method,
      path: req.path,
      requestId,
      ip: req.socket?.remoteAddress || req.ip,
    });

    res.status(404).json({
      error: {
        message: `Cannot ${req.method} ${req.path}`,
        code: "NOT_FOUND",
        status: 404,
        ...(requestId && { requestId }),
      },
    });
  };
}

/**
 * Async handler wrapper
 * Catches errors from async route handlers and passes them to error middleware
 *
 * @example
 * app.get("/route", asyncHandler(async (req, res) => {
 *   const data = await fetchData();
 *   res.json(data);
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
