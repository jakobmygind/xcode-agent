/**
 * Tests for CORS middleware
 */
import { describe, it, expect } from "vitest";
import { Request, Response } from "express";
import {
  createCORSMiddleware,
  allowAllCORS,
  defaultCORSConfig,
} from "../cors.js";

// Mock Request and Response helpers
function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    method: "GET",
    headers: {},
    path: "/",
    ...overrides,
  };
}

interface MockResponse {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  ended: boolean;
  status(code: number): MockResponse;
  send(): MockResponse;
  json(data: unknown): MockResponse;
  header(name: string, value: string): MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    headers: {},
    ended: false,
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    send: function () {
      this.ended = true;
      return this;
    },
    json: function (data: unknown) {
      this.body = data;
      this.ended = true;
      return this;
    },
    header: function (name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

describe("CORS Middleware", () => {
  describe("defaultCORSConfig", () => {
    it("should have sensible defaults", () => {
      expect(defaultCORSConfig.allowedOrigins).toContain("*");
      expect(defaultCORSConfig.allowedMethods).toContain("GET");
      expect(defaultCORSConfig.allowedMethods).toContain("POST");
      expect(defaultCORSConfig.allowCredentials).toBe(true);
      expect(defaultCORSConfig.maxAge).toBe(86400);
    });

    it("should include webhook headers", () => {
      expect(defaultCORSConfig.allowedHeaders).toContain("X-GitHub-Event");
      expect(defaultCORSConfig.allowedHeaders).toContain("X-Hub-Signature-256");
    });
  });

  describe("createCORSMiddleware", () => {
    it("should set CORS headers for allowed origins", () => {
      const middleware = createCORSMiddleware({
        allowedOrigins: ["http://localhost:3000"],
      });

      const req = createMockRequest({
        headers: { origin: "http://localhost:3000" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
      expect(res.headers["Access-Control-Allow-Methods"]).toBeDefined();
      expect(res.headers["Access-Control-Allow-Headers"]).toBeDefined();
    });

    it("should not set CORS headers for disallowed origins", () => {
      const middleware = createCORSMiddleware({
        allowedOrigins: ["http://localhost:3000"],
      });

      const req = createMockRequest({
        headers: { origin: "http://evil.com" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("should allow all origins with wildcard", () => {
      const middleware = createCORSMiddleware({
        allowedOrigins: ["*"],
        allowCredentials: false,
      });

      const req = createMockRequest({
        headers: { origin: "http://any-origin.com" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    });

    it("should echo origin when using wildcard with credentials", () => {
      const middleware = createCORSMiddleware({
        allowedOrigins: ["*"],
        allowCredentials: true,
      });

      const req = createMockRequest({
        headers: { origin: "http://localhost:3000" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
      expect(res.headers["Access-Control-Allow-Credentials"]).toBe("true");
    });

    it("should handle preflight OPTIONS requests", () => {
      const middleware = createCORSMiddleware({
        allowedOrigins: ["*"],
      });

      const req = createMockRequest({
        method: "OPTIONS",
        headers: { origin: "http://localhost:3000" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBe(204);
      expect(res.ended).toBe(true);
    });

    it("should set expose headers", () => {
      const middleware = createCORSMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Access-Control-Expose-Headers"]).toContain("Content-Length");
      expect(res.headers["Access-Control-Expose-Headers"]).toContain("X-Protocol-Version");
    });

    it("should set max-age header", () => {
      const middleware = createCORSMiddleware({
        maxAge: 3600,
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Access-Control-Max-Age"]).toBe("3600");
    });

    it("should call next() for non-OPTIONS requests", () => {
      const middleware = createCORSMiddleware();

      const req = createMockRequest({ method: "GET" }) as Request;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res as any, next);

      expect(nextCalled).toBe(true);
      expect(res.ended).toBe(false);
    });

    it("should handle requests without origin header", () => {
      const middleware = createCORSMiddleware({
        allowedOrigins: ["http://localhost:3000"],
      });

      const req = createMockRequest({ headers: {} }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      // Should not set CORS headers but should still call next
      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });
  });

  describe("allowAllCORS", () => {
    it("should allow all origins without credentials", () => {
      const middleware = allowAllCORS();

      const req = createMockRequest({
        headers: { origin: "http://any-origin.com" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(res.headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    });
  });
});
