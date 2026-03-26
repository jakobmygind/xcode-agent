/**
 * Tests for rate limit middleware
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request, Response } from "express";
import {
  createRateLimitMiddleware,
  createAuthRateLimitMiddleware,
} from "../rate-limit.js";

// Mock Request and Response helpers
function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    method: "GET",
    path: "/",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" } as any,
    ...overrides,
  };
}

interface MockResponse {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  ended: boolean;
  status(code: number): MockResponse;
  json(data: unknown): MockResponse;
  setHeader(name: string, value: string): MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    headers: {},
    ended: false,
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    json: function (data: unknown) {
      this.body = data;
      this.ended = true;
      return this;
    },
    setHeader: function (name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

describe("Rate Limit Middleware", () => {
  describe("createRateLimitMiddleware", () => {
    it("should allow requests within limit", () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 5,
        windowMs: 60000,
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res as any, next);

      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBeUndefined();
      expect(res.headers["X-RateLimit-Limit"]).toBe("5");
      expect(res.headers["X-RateLimit-Remaining"]).toBe("4");
    });

    it("should block requests over limit", () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 2,
        windowMs: 60000,
      });

      const ip = "192.168.1.100";

      // First 2 requests should pass
      for (let i = 0; i < 2; i++) {
        const req = createMockRequest({
          socket: { remoteAddress: ip } as any,
        }) as Request;
        const res = createMockResponse();
        const next = () => {};
        middleware(req, res as any, next);
      }

      // 3rd request should be blocked
      const req = createMockRequest({
        socket: { remoteAddress: ip } as any,
      }) as Request;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res as any, next);

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(429);
      expect(res.body).toMatchObject({ error: "Too Many Requests" });
    });

    it("should track different IPs separately", () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 2,
        windowMs: 60000,
      });

      // Exhaust limit for IP 1
      for (let i = 0; i < 2; i++) {
        const req = createMockRequest({
          socket: { remoteAddress: "192.168.1.1" } as any,
        }) as Request;
        const res = createMockResponse();
        middleware(req, res as any, () => {});
      }

      // IP 2 should still be allowed
      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.2" } as any,
      }) as Request;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res as any, next);

      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBeUndefined();
    });

    it("should set rate limit headers", () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 10,
        windowMs: 60000,
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["X-RateLimit-Limit"]).toBe("10");
      expect(res.headers["X-RateLimit-Remaining"]).toBe("9");
      expect(res.headers["X-RateLimit-Reset"]).toBeDefined();
    });

    it("should skip rate limiting when configured", () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 1,
        windowMs: 60000,
        skip: (req) => req.path === "/health",
      });

      // Make 3 requests to /health - should all pass
      for (let i = 0; i < 3; i++) {
        const req = createMockRequest({ path: "/health" }) as Request;
        const res = createMockResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res as any, next);

        expect(nextCalled).toBe(true);
      }
    });

    it("should use custom key generator", () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 1,
        windowMs: 60000,
        keyGenerator: (req) => req.headers["x-api-key"] as string || "default",
      });

      // Different IPs, same API key - should share limit
      const req1 = createMockRequest({
        socket: { remoteAddress: "192.168.1.1" } as any,
        headers: { "x-api-key": "key-123" },
      }) as Request;
      const res1 = createMockResponse();
      middleware(req1, res1 as any, () => {});

      const req2 = createMockRequest({
        socket: { remoteAddress: "192.168.1.2" } as any,
        headers: { "x-api-key": "key-123" },
      }) as Request;
      const res2 = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req2, res2 as any, next);

      expect(nextCalled).toBe(false);
      expect(res2.statusCode).toBe(429);
    });

    it("should include retry-after header on 429", () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 1,
        windowMs: 300000, // 5 minutes
      });

      // Exhaust limit
      const req1 = createMockRequest() as Request;
      const res1 = createMockResponse();
      middleware(req1, res1 as any, () => {});

      // Second request should be blocked with retry-after
      const req2 = createMockRequest() as Request;
      const res2 = createMockResponse();
      middleware(req2, res2 as any, () => {});

      expect(res2.body).toMatchObject({ retryAfter: 300 });
    });
  });

  describe("createAuthRateLimitMiddleware", () => {
    it("should have stricter defaults", () => {
      const middleware = createAuthRateLimitMiddleware();

      // Should allow 10 requests
      for (let i = 0; i < 10; i++) {
        const req = createMockRequest() as Request;
        const res = createMockResponse();
        middleware(req, res as any, () => {});
      }

      // 11th should be blocked
      const req = createMockRequest() as Request;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res as any, next);

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(429);
    });

    it("should use owner/repo in key for webhook endpoints", () => {
      const middleware = createAuthRateLimitMiddleware();

      // Same IP, different owners - should have separate limits
      const req1 = createMockRequest({
        socket: { remoteAddress: "192.168.1.1" } as any,
        body: { owner: "user1", repo: "repo1" },
      }) as Request;
      const res1 = createMockResponse();
      middleware(req1, res1 as any, () => {});

      const req2 = createMockRequest({
        socket: { remoteAddress: "192.168.1.1" } as any,
        body: { owner: "user2", repo: "repo2" },
      }) as Request;
      const res2 = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req2, res2 as any, next);

      expect(nextCalled).toBe(true);
    });
  });
});
