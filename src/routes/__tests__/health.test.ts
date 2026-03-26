/**
 * Tests for health routes
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Request, Response } from "express";
import {
  createHealthRouter,
  createLegacyHealthHandler,
  getVersion,
  HealthResponse,
} from "../health.js";
import { PROTOCOL_VERSION } from "../../middleware/auth.js";

// Mock Request and Response helpers
interface MockResponse {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  json(data: unknown): MockResponse;
  status(code: number): MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    headers: {},
    json: function (data: unknown) {
      this.body = data;
      return this;
    },
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
  };
  return res;
}

describe("Health Routes", () => {
  describe("getVersion", () => {
    it("should return a version string", () => {
      const version = getVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    });

    it("should return cached version on subsequent calls", () => {
      const version1 = getVersion();
      const version2 = getVersion();
      expect(version1).toBe(version2);
    });

    it("should return valid semver format", () => {
      const version = getVersion();
      // Basic semver regex: major.minor.patch with optional prerelease
      const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
      expect(version).toMatch(semverRegex);
    });
  });

  describe("createHealthRouter", () => {
    it("should return a router with /health endpoint", () => {
      const router = createHealthRouter();
      expect(router).toBeDefined();
      // Express router has stack property with registered routes
      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);
    });

    it("should handle GET /health requests", () => {
      const router = createHealthRouter();

      // Find the GET /health handler
      const healthRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/health" && layer.route.methods.get
      );
      expect(healthRoute).toBeDefined();
    });
  });

  describe("Health endpoint handler", () => {
    it("should return correct response structure", () => {
      const handler = createLegacyHealthHandler();
      const req = {} as Request;
      const res = createMockResponse();

      handler(req, res as any);

      const body = res.body as HealthResponse;
      expect(body.status).toBe("ok");
      expect(typeof body.version).toBe("string");
      expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(typeof body.timestamp).toBe("string");
    });

    it("should return valid ISO timestamp", () => {
      const handler = createLegacyHealthHandler();
      const req = {} as Request;
      const res = createMockResponse();

      handler(req, res as any);

      const body = res.body as HealthResponse;
      const timestamp = new Date(body.timestamp);
      expect(timestamp.toISOString()).toBe(body.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it("should return current timestamp", () => {
      const before = Date.now();
      const handler = createLegacyHealthHandler();
      const req = {} as Request;
      const res = createMockResponse();

      handler(req, res as any);

      const after = Date.now();
      const body = res.body as HealthResponse;
      const timestamp = new Date(body.timestamp).getTime();

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it("should return positive protocol version", () => {
      const handler = createLegacyHealthHandler();
      const req = {} as Request;
      const res = createMockResponse();

      handler(req, res as any);

      const body = res.body as HealthResponse;
      expect(body.protocolVersion).toBeGreaterThan(0);
    });
  });

  describe("HealthResponse interface", () => {
    it("should accept valid health response", () => {
      const response: HealthResponse = {
        status: "ok",
        version: "1.0.0",
        protocolVersion: 1,
        timestamp: new Date().toISOString(),
      };

      expect(response.status).toBe("ok");
    });
  });
});
