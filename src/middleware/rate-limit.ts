import { Request, Response, NextFunction } from "express";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Function to generate a unique key for each client (default: IP address) */
  keyGenerator?: (req: Request) => string;
  /** Handler called when rate limit is exceeded */
  onLimitExceeded?: (req: Request, res: Response) => void;
  /** Skip rate limiting for certain requests */
  skip?: (req: Request) => boolean;
}

/**
 * Default rate limit configuration
 * 100 requests per minute per IP
 */
export const defaultRateLimitConfig: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
};

/**
 * Store for tracking request counts
 * Uses a Map with automatic cleanup to prevent memory leaks
 */
class RateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private windowMs: number) {
    // Cleanup expired entries every window period
    this.cleanupInterval = setInterval(() => this.cleanup(), windowMs);
    // Ensure cleanup doesn't prevent process exit
    this.cleanupInterval.unref?.();
  }

  /**
   * Get current count for a key, or initialize if not exists
   */
  get(key: string): { count: number; resetTime: number } {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || now > existing.resetTime) {
      // Reset if window has passed
      const newEntry = { count: 0, resetTime: now + this.windowMs };
      this.store.set(key, newEntry);
      return newEntry;
    }

    return existing;
  }

  /**
   * Increment count for a key
   */
  increment(key: string): { count: number; resetTime: number } {
    const entry = this.get(key);
    entry.count++;
    return entry;
  }

  /**
   * Remove expired entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Destroy the store and stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

/**
 * Create rate limiting middleware
 *
 * Tracks requests per client and returns 429 Too Many Requests when limit is exceeded.
 * Includes automatic cleanup to prevent memory leaks.
 *
 * @example
 * // Strict rate limit for auth endpoints
 * app.use("/api/", createRateLimitMiddleware({ maxRequests: 5, windowMs: 60000 }));
 *
 * // General rate limit
 * app.use(createRateLimitMiddleware());
 */
export function createRateLimitMiddleware(config: Partial<RateLimitConfig> = {}) {
  const fullConfig = { ...defaultRateLimitConfig, ...config };
  const store = new RateLimitStore(fullConfig.windowMs);

  const keyGenerator = fullConfig.keyGenerator || ((req: Request) => {
    // Use IP address as default key, fallback to "unknown"
    return req.socket?.remoteAddress || req.ip || "unknown";
  });

  const onLimitExceeded = fullConfig.onLimitExceeded || ((req: Request, res: Response) => {
    res.status(429).json({
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please try again later.",
      retryAfter: Math.ceil(fullConfig.windowMs / 1000),
    });
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip if configured
    if (fullConfig.skip?.(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const entry = store.increment(key);

    // Add rate limit headers
    res.setHeader("X-RateLimit-Limit", fullConfig.maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", Math.max(0, fullConfig.maxRequests - entry.count).toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetTime / 1000).toString());

    if (entry.count > fullConfig.maxRequests) {
      return onLimitExceeded(req, res);
    }

    next();
  };
}

/**
 * Create a stricter rate limiter for authentication endpoints
 * More restrictive to prevent brute force attacks
 */
export function createAuthRateLimitMiddleware() {
  return createRateLimitMiddleware({
    maxRequests: 10, // 10 attempts
    windowMs: 5 * 60 * 1000, // per 5 minutes
    keyGenerator: (req: Request) => {
      // Combine IP and username/body to prevent one user blocking others behind same NAT
      const ip = req.socket?.remoteAddress || req.ip || "unknown";
      const body = req.body as Record<string, unknown> | undefined;
      const identifier = body?.owner || body?.repo || "";
      return `${ip}:${identifier}`;
    },
  });
}
