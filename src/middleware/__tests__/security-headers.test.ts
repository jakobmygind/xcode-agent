/**
 * Tests for security headers middleware
 */
import { describe, it, expect } from "vitest";
import { Request, Response } from "express";
import {
  createSecurityHeadersMiddleware,
  createDevSecurityHeadersMiddleware,
  defaultSecurityConfig,
} from "../security-headers.js";

// Mock Request and Response helpers
function createMockRequest(): Partial<Request> {
  return {
    method: "GET",
    path: "/",
    headers: {},
  };
}

interface MockResponse {
  headers: Record<string, string>;
  set(name: string, value: string): MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    headers: {},
    set: function (name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

describe("Security Headers Middleware", () => {
  describe("defaultSecurityConfig", () => {
    it("should have secure defaults", () => {
      expect(defaultSecurityConfig.contentSecurityPolicy).toContain("default-src 'none'");
      expect(defaultSecurityConfig.frameOptions).toBe("DENY");
      expect(defaultSecurityConfig.contentTypeOptions).toBe(true);
      expect(defaultSecurityConfig.hsts).toMatchObject({
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      });
    });
  });

  describe("createSecurityHeadersMiddleware", () => {
    it("should set all security headers", () => {
      const middleware = createSecurityHeadersMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Content-Security-Policy"]).toBeDefined();
      expect(res.headers["Strict-Transport-Security"]).toBeDefined();
      expect(res.headers["X-Frame-Options"]).toBe("DENY");
      expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(res.headers["Referrer-Policy"]).toBeDefined();
      expect(res.headers["Permissions-Policy"]).toBeDefined();
      expect(res.headers["X-DNS-Prefetch-Control"]).toBe("off");
      expect(res.headers["X-Download-Options"]).toBe("noopen");
      expect(res.headers["X-Permitted-Cross-Domain-Policies"]).toBe("none");
    });

    it("should set HSTS with correct values", () => {
      const middleware = createSecurityHeadersMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      const hsts = res.headers["Strict-Transport-Security"];
      expect(hsts).toContain("max-age=31536000");
      expect(hsts).toContain("includeSubDomains");
      expect(hsts).toContain("preload");
    });

    it("should set CSP to deny by default", () => {
      const middleware = createSecurityHeadersMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Content-Security-Policy"]).toContain("default-src 'none'");
      expect(res.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    });

    it("should disable XSS protection when configured", () => {
      const middleware = createSecurityHeadersMiddleware({
        xssProtection: false,
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["X-XSS-Protection"]).toBe("0");
    });

    it("should enable XSS protection when configured", () => {
      const middleware = createSecurityHeadersMiddleware({
        xssProtection: true,
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["X-XSS-Protection"]).toBe("1; mode=block");
    });

    it("should allow custom CSP", () => {
      const customCSP = "default-src 'self'; script-src 'unsafe-inline'";
      const middleware = createSecurityHeadersMiddleware({
        contentSecurityPolicy: customCSP,
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Content-Security-Policy"]).toBe(customCSP);
    });

    it("should allow disabling specific headers", () => {
      const middleware = createSecurityHeadersMiddleware({
        contentSecurityPolicy: false,
        hsts: false,
        frameOptions: false,
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Content-Security-Policy"]).toBeUndefined();
      expect(res.headers["Strict-Transport-Security"]).toBeUndefined();
      expect(res.headers["X-Frame-Options"]).toBeUndefined();
      // Other headers should still be set
      expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    });

    it("should set frame options to SAMEORIGIN when configured", () => {
      const middleware = createSecurityHeadersMiddleware({
        frameOptions: "SAMEORIGIN",
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    });

    it("should enable DNS prefetch when configured", () => {
      const middleware = createSecurityHeadersMiddleware({
        dnsPrefetchControl: true,
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["X-DNS-Prefetch-Control"]).toBe("on");
    });

    it("should set custom referrer policy", () => {
      const middleware = createSecurityHeadersMiddleware({
        referrerPolicy: "no-referrer",
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Referrer-Policy"]).toBe("no-referrer");
    });

    it("should always call next()", () => {
      const middleware = createSecurityHeadersMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res as any, next);

      expect(nextCalled).toBe(true);
    });
  });

  describe("createDevSecurityHeadersMiddleware", () => {
    it("should disable HSTS for development", () => {
      const middleware = createDevSecurityHeadersMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse();
      const next = () => {};

      middleware(req, res as any, next);

      expect(res.headers["Strict-Transport-Security"]).toBeUndefined();
      expect(res.headers["X-Frame-Options"]).toBe("DENY");
      expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    });
  });
});
