/**
 * Tests for auth middleware
 *
 * Run with: npm test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Request, Response } from "express";
import {
  getPeerIP,
  isLoopbackAddress,
  extractBearerToken,
  extractTokenFromQuery,
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  PROTOCOL_VERSION,
} from "../auth.js";

// Mock Request and Response helpers
function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    headers: {},
    query: {},
    socket: { remoteAddress: "127.0.0.1" } as any,
    ...overrides,
  };
}

interface MockResponse {
  statusCode?: number;
  body?: any;
  headers?: Record<string, string>;
  status(code: number): MockResponse;
  json(data: any): MockResponse;
  header(name: string, value: string): MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    json: function (data: any) {
      this.body = data;
      return this;
    },
    header: function (name: string, value: string) {
      if (!this.headers) this.headers = {};
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

describe("Auth Middleware", () => {
  describe("PROTOCOL_VERSION", () => {
    it("should be defined as a number", () => {
      expect(typeof PROTOCOL_VERSION).toBe("number");
      expect(PROTOCOL_VERSION).toBeGreaterThan(0);
    });
  });

  describe("isLoopbackAddress", () => {
    it("should return true for IPv4 loopback addresses", () => {
      expect(isLoopbackAddress("127.0.0.1")).toBe(true);
      expect(isLoopbackAddress("127.0.0.2")).toBe(true);
      expect(isLoopbackAddress("127.255.255.255")).toBe(true);
    });

    it("should return true for IPv6 loopback addresses", () => {
      expect(isLoopbackAddress("::1")).toBe(true);
      expect(isLoopbackAddress("0:0:0:0:0:0:0:1")).toBe(true);
    });

    it("should return true for IPv6-mapped IPv4 loopback", () => {
      expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
      expect(isLoopbackAddress("::ffff:127.1.2.3")).toBe(true);
    });

    it("should return false for non-loopback addresses", () => {
      expect(isLoopbackAddress("192.168.1.1")).toBe(false);
      expect(isLoopbackAddress("10.0.0.1")).toBe(false);
      expect(isLoopbackAddress("172.16.0.1")).toBe(false);
      expect(isLoopbackAddress("8.8.8.8")).toBe(false);
      expect(isLoopbackAddress("::ffff:192.168.1.1")).toBe(false);
    });

    it("should return false for empty or invalid addresses", () => {
      expect(isLoopbackAddress("")).toBe(false);
      expect(isLoopbackAddress("invalid")).toBe(false);
      expect(isLoopbackAddress("127")).toBe(false);
    });
  });

  describe("getPeerIP", () => {
    it("should return socket remoteAddress by default", () => {
      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
      });
      expect(getPeerIP(req as Request)).toBe("192.168.1.100");
    });

    it("should use X-Forwarded-For when connection is from loopback", () => {
      const req = createMockRequest({
        socket: { remoteAddress: "127.0.0.1" } as any,
        headers: { "x-forwarded-for": "10.0.0.5" },
      });
      expect(getPeerIP(req as Request)).toBe("10.0.0.5");
    });

    it("should use first IP from X-Forwarded-For chain", () => {
      const req = createMockRequest({
        socket: { remoteAddress: "127.0.0.1" } as any,
        headers: { "x-forwarded-for": "10.0.0.5, 192.168.1.1, 172.16.0.1" },
      });
      expect(getPeerIP(req as Request)).toBe("10.0.0.5");
    });

    it("should ignore X-Forwarded-For from non-loopback connections", () => {
      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
        headers: { "x-forwarded-for": "10.0.0.5" },
      });
      expect(getPeerIP(req as Request)).toBe("192.168.1.100");
    });

    it("should handle IPv6 loopback for X-Forwarded-For trust", () => {
      const req = createMockRequest({
        socket: { remoteAddress: "::1" } as any,
        headers: { "x-forwarded-for": "10.0.0.5" },
      });
      expect(getPeerIP(req as Request)).toBe("10.0.0.5");
    });

    it("should return empty string when no IP is available", () => {
      const req = createMockRequest({
        socket: { remoteAddress: undefined } as any,
      });
      expect(getPeerIP(req as Request)).toBe("");
    });
  });

  describe("extractBearerToken", () => {
    it("should extract token from Authorization header", () => {
      const req = createMockRequest({
        headers: { authorization: "Bearer my-token-123" },
      });
      expect(extractBearerToken(req as Request)).toBe("my-token-123");
    });

    it("should handle lowercase 'bearer'", () => {
      const req = createMockRequest({
        headers: { authorization: "bearer my-token-123" },
      });
      expect(extractBearerToken(req as Request)).toBe("my-token-123");
    });

    it("should return null for missing Authorization header", () => {
      const req = createMockRequest();
      expect(extractBearerToken(req as Request)).toBeNull();
    });

    it("should return null for invalid format", () => {
      const req = createMockRequest({
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(extractBearerToken(req as Request)).toBeNull();
    });

    it("should return null for malformed header", () => {
      const req = createMockRequest({
        headers: { authorization: "Bearer" },
      });
      expect(extractBearerToken(req as Request)).toBeNull();
    });
  });

  describe("extractTokenFromQuery", () => {
    it("should extract token from query parameter", () => {
      const req = createMockRequest({
        query: { token: "my-query-token" },
      });
      expect(extractTokenFromQuery(req as Request)).toBe("my-query-token");
    });

    it("should return null for missing token", () => {
      const req = createMockRequest();
      expect(extractTokenFromQuery(req as Request)).toBeNull();
    });

    it("should return null for non-string token", () => {
      const req = createMockRequest({
        query: { token: ["token1", "token2"] },
      });
      expect(extractTokenFromQuery(req as Request)).toBeNull();
    });
  });

  describe("createAuthMiddleware", () => {
    it("should allow loopback connections when allowLocalUnauthenticated is true", () => {
      const middleware = createAuthMiddleware({
        bearerToken: "secret",
        allowLocalUnauthenticated: true,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "127.0.0.1" } as any,
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBeUndefined();
      expect((req as any).auth).toEqual({ type: "loopback", ip: "127.0.0.1" });
    });

    it("should require auth for loopback when allowLocalUnauthenticated is false", () => {
      const middleware = createAuthMiddleware({
        bearerToken: "secret",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "127.0.0.1" } as any,
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("should allow requests with valid bearer token", () => {
      const middleware = createAuthMiddleware({
        bearerToken: "valid-token",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
        headers: { authorization: "Bearer valid-token" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBeUndefined();
      expect((req as any).auth).toEqual({ type: "bearer", ip: "192.168.1.100" });
    });

    it("should reject requests with invalid bearer token", () => {
      const middleware = createAuthMiddleware({
        bearerToken: "valid-token",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
        headers: { authorization: "Bearer invalid-token" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBe(401);
    });

    it("should accept token from query parameter", () => {
      const middleware = createAuthMiddleware({
        bearerToken: "valid-token",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
        query: { token: "valid-token" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBeUndefined();
      expect((req as any).auth.type).toBe("bearer");
    });

    it("should reject requests when no token is configured", () => {
      const middleware = createAuthMiddleware({
        bearerToken: undefined,
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
        headers: { authorization: "Bearer some-token" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toContain("No bearer token configured");
    });

    it("should reject requests with missing token", () => {
      const middleware = createAuthMiddleware({
        bearerToken: "secret",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toContain("Authentication required");
    });

    it("should use timing-safe comparison (different length tokens)", () => {
      const middleware = createAuthMiddleware({
        bearerToken: "short",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
        headers: { authorization: "Bearer this-is-a-much-longer-token" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.statusCode).toBe(401);
    });
  });

  describe("createOptionalAuthMiddleware", () => {
    it("should attach loopback auth info without rejecting", () => {
      const middleware = createOptionalAuthMiddleware({
        bearerToken: "secret",
        allowLocalUnauthenticated: true,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "127.0.0.1" } as any,
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect((req as any).auth).toEqual({ type: "loopback", ip: "127.0.0.1" });
    });

    it("should attach bearer auth info for valid tokens", () => {
      const middleware = createOptionalAuthMiddleware({
        bearerToken: "valid-token",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
        headers: { authorization: "Bearer valid-token" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect((req as any).auth.type).toBe("bearer");
    });

    it("should attach 'none' auth type when no token provided", () => {
      const middleware = createOptionalAuthMiddleware({
        bearerToken: "secret",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect((req as any).auth.type).toBe("none");
    });

    it("should attach 'invalid' auth type for wrong tokens", () => {
      const middleware = createOptionalAuthMiddleware({
        bearerToken: "valid-token",
        allowLocalUnauthenticated: false,
      });

      const req = createMockRequest({
        socket: { remoteAddress: "192.168.1.100" } as any,
        headers: { authorization: "Bearer wrong-token" },
      }) as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect((req as any).auth.type).toBe("invalid");
    });
  });
});
