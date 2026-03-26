/**
 * Tests for error handler middleware
 */
import { describe, it, expect, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import {
  createErrorHandlerMiddleware,
  createNotFoundHandler,
  asyncHandler,
  HTTPError,
  Errors,
} from "../error-handler.js";

// Mock Logger
const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Mock Request and Response helpers
function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    method: "GET",
    path: "/",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" } as any,
    get: (header: string) => undefined,
    ...overrides,
  };
}

interface MockResponse {
  statusCode?: number;
  body?: unknown;
  headersSent: boolean;
  headers: Record<string, string>;
  status(code: number): MockResponse;
  json(data: unknown): MockResponse;
  setHeader(name: string, value: string): MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    headersSent: false,
    headers: {},
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    json: function (data: unknown) {
      this.body = data;
      return this;
    },
    setHeader: function (name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

describe("Error Handler Middleware", () => {
  describe("HTTPError", () => {
    it("should create error with status code", () => {
      const error = new HTTPError(404, "Not found", "NOT_FOUND", { resource: "user" });

      expect(error.statusCode).toBe(404);
      expect(error.message).toBe("Not found");
      expect(error.code).toBe("NOT_FOUND");
      expect(error.details).toEqual({ resource: "user" });
      expect(error.name).toBe("HTTPError");
    });
  });

  describe("Errors factory", () => {
    it("should create badRequest error", () => {
      const error = Errors.badRequest("Invalid input", { field: "email" });
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("BAD_REQUEST");
    });

    it("should create unauthorized error", () => {
      const error = Errors.unauthorized();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("UNAUTHORIZED");
    });

    it("should create forbidden error", () => {
      const error = Errors.forbidden();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe("FORBIDDEN");
    });

    it("should create notFound error", () => {
      const error = Errors.notFound("User");
      expect(error.statusCode).toBe(404);
      expect(error.message).toContain("User not found");
    });

    it("should create conflict error", () => {
      const error = Errors.conflict("Duplicate entry");
      expect(error.statusCode).toBe(409);
    });

    it("should create tooManyRequests error", () => {
      const error = Errors.tooManyRequests();
      expect(error.statusCode).toBe(429);
    });

    it("should create internal error", () => {
      const error = Errors.internal();
      expect(error.statusCode).toBe(500);
    });

    it("should create notImplemented error", () => {
      const error = Errors.notImplemented("feature");
      expect(error.statusCode).toBe(501);
      expect(error.message).toContain("feature not implemented");
    });

    it("should create badGateway error", () => {
      const error = Errors.badGateway();
      expect(error.statusCode).toBe(502);
    });

    it("should create serviceUnavailable error", () => {
      const error = Errors.serviceUnavailable();
      expect(error.statusCode).toBe(503);
    });
  });

  describe("createErrorHandlerMiddleware", () => {
    it("should handle HTTPError with correct status", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({ logger });

      const error = new HTTPError(404, "Not found", "NOT_FOUND");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect(res.statusCode).toBe(404);
      expect(res.body).toMatchObject({
        error: {
          message: "Not found",
          code: "NOT_FOUND",
          status: 404,
        },
      });
    });

    it("should handle generic errors as 500", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({ logger });

      const error = new Error("Something went wrong");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({
        error: {
          message: "Something went wrong",
          code: "INTERNAL_ERROR",
          status: 500,
        },
      });
    });

    it("should include request ID when available", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({ logger });

      const error = new HTTPError(400, "Bad request");
      const req = createMockRequest({ requestId: "req-123" } as any) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect((res.body as any).error.requestId).toBe("req-123");
    });

    it("should include stack trace in development", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({
        logger,
        includeStack: true,
      });

      const error = new Error("Test error");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect((res.body as any).error.stack).toBeDefined();
    });

    it("should not include stack trace by default", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({ logger });

      const error = new Error("Test error");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect((res.body as any).error.stack).toBeUndefined();
    });

    it("should log 5xx errors as errors", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({ logger });

      const error = new HTTPError(500, "Server error");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect(logger.error).toHaveBeenCalled();
    });

    it("should log 4xx errors as warnings", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({ logger });

      const error = new HTTPError(400, "Bad request");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect(logger.warn).toHaveBeenCalled();
    });

    it("should not send response if headers already sent", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({ logger });

      const error = new Error("Late error");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      res.headersSent = true;
      const next = () => {};

      middleware(error, req, res as any, next);

      expect(res.statusCode).toBeUndefined();
      expect(res.body).toBeUndefined();
    });

    it("should call onError callback when provided", () => {
      const logger = createMockLogger();
      const onError = vi.fn();
      const middleware = createErrorHandlerMiddleware({ logger, onError });

      const error = new Error("Test");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect(onError).toHaveBeenCalledWith(error, req, res);
    });

    it("should handle onError callback errors gracefully", () => {
      const logger = createMockLogger();
      const onError = vi.fn(() => { throw new Error("Callback error"); });
      const middleware = createErrorHandlerMiddleware({ logger, onError });

      const error = new Error("Test");
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      // Should not throw
      expect(() => middleware(error, req, res as any, next)).not.toThrow();
      expect(res.statusCode).toBe(500);
    });

    it("should include error details when provided", () => {
      const logger = createMockLogger();
      const middleware = createErrorHandlerMiddleware({ logger });

      const error = new HTTPError(400, "Validation failed", "VALIDATION_ERROR", {
        fields: ["email", "password"],
      });
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(error, req, res as any, next);

      expect((res.body as any).error.details).toEqual({ fields: ["email", "password"] });
    });
  });

  describe("createNotFoundHandler", () => {
    it("should return 404 for unknown routes", () => {
      const logger = createMockLogger();
      const handler = createNotFoundHandler({ logger });

      const req = createMockRequest({ method: "GET", path: "/unknown" }) as Request;
      const res = createMockResponse();

      handler(req, res as any);

      expect(res.statusCode).toBe(404);
      expect(res.body).toMatchObject({
        error: {
          message: "Cannot GET /unknown",
          code: "NOT_FOUND",
          status: 404,
        },
      });
    });

    it("should include request ID when available", () => {
      const logger = createMockLogger();
      const handler = createNotFoundHandler({ logger });

      const req = createMockRequest({ requestId: "req-456" } as any) as Request;
      const res = createMockResponse();

      handler(req, res as any);

      expect((res.body as any).error.requestId).toBe("req-456");
    });

    it("should log not found warnings", () => {
      const logger = createMockLogger();
      const handler = createNotFoundHandler({ logger });

      const req = createMockRequest({ method: "POST", path: "/api/test" }) as Request;
      const res = createMockResponse();

      handler(req, res as any);

      expect(logger.warn).toHaveBeenCalledWith("Route not found", expect.any(Object));
    });
  });

  describe("asyncHandler", () => {
    it("should call next() on resolved promise", async () => {
      const handler = asyncHandler(async (req, res) => {
        res.json({ success: true });
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = vi.fn();

      await handler(req, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.body).toEqual({ success: true });
    });

    it("should call next() with error on rejected promise", async () => {
      const error = new Error("Async error");
      const handler = asyncHandler(async (req, res) => {
        throw error;
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = vi.fn();

      await handler(req, res as any, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
