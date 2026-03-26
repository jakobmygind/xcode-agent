import { Request, Response, NextFunction } from "express";

/**
 * Security headers configuration
 */
export interface SecurityHeadersConfig {
  /** Content Security Policy */
  contentSecurityPolicy?: string | false;
  /** Strict Transport Security (HSTS) */
  hsts?: {
    maxAge: number;
    includeSubDomains: boolean;
    preload: boolean;
  } | false;
  /** X-Frame-Options */
  frameOptions?: "DENY" | "SAMEORIGIN" | false;
  /** X-Content-Type-Options */
  contentTypeOptions?: boolean;
  /** Referrer-Policy */
  referrerPolicy?: string | false;
  /** Permissions-Policy */
  permissionsPolicy?: string | false;
  /** X-DNS-Prefetch-Control */
  dnsPrefetchControl?: boolean;
  /** X-Download-Options (IE only) */
  downloadOptions?: boolean;
  /** X-XSS-Protection (legacy, CSP is preferred) */
  xssProtection?: boolean;
}

/**
 * Default security headers configuration
 * Secure defaults for API server
 */
export const defaultSecurityConfig: SecurityHeadersConfig = {
  // API doesn't serve HTML, so strict CSP
  contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none';",
  // HSTS - force HTTPS (only enable in production with valid certs)
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  // Prevent clickjacking
  frameOptions: "DENY",
  // Prevent MIME type sniffing
  contentTypeOptions: true,
  // Minimal referrer info
  referrerPolicy: "strict-origin-when-cross-origin",
  // Restrict browser features
  permissionsPolicy: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  // Disable DNS prefetching
  dnsPrefetchControl: false,
  // Disable IE download opening
  downloadOptions: true,
  // Legacy XSS protection (disabled as we use CSP)
  xssProtection: false,
};

/**
 * Create security headers middleware
 *
 * Sets important security headers to protect against common attacks:
 * - XSS
 * - Clickjacking
 * - MIME sniffing
 * - Protocol downgrade attacks
 *
 * @example
 * app.use(createSecurityHeadersMiddleware());
 *
 * // Disable HSTS for local development
 * app.use(createSecurityHeadersMiddleware({ hsts: false }));
 */
export function createSecurityHeadersMiddleware(config: Partial<SecurityHeadersConfig> = {}) {
  const fullConfig = { ...defaultSecurityConfig, ...config };

  return (req: Request, res: Response, next: NextFunction): void => {
    // Content Security Policy
    if (fullConfig.contentSecurityPolicy) {
      res.set("Content-Security-Policy", fullConfig.contentSecurityPolicy);
    }

    // Strict Transport Security
    if (fullConfig.hsts) {
      const hstsValue = [
        `max-age=${fullConfig.hsts.maxAge}`,
        fullConfig.hsts.includeSubDomains ? "includeSubDomains" : "",
        fullConfig.hsts.preload ? "preload" : "",
      ].filter(Boolean).join("; ");
      res.set("Strict-Transport-Security", hstsValue);
    }

    // X-Frame-Options
    if (fullConfig.frameOptions) {
      res.set("X-Frame-Options", fullConfig.frameOptions);
    }

    // X-Content-Type-Options
    if (fullConfig.contentTypeOptions) {
      res.set("X-Content-Type-Options", "nosniff");
    }

    // Referrer-Policy
    if (fullConfig.referrerPolicy) {
      res.set("Referrer-Policy", fullConfig.referrerPolicy);
    }

    // Permissions-Policy
    if (fullConfig.permissionsPolicy) {
      res.set("Permissions-Policy", fullConfig.permissionsPolicy);
    }

    // X-DNS-Prefetch-Control
    if (fullConfig.dnsPrefetchControl !== undefined) {
      res.set("X-DNS-Prefetch-Control", fullConfig.dnsPrefetchControl ? "on" : "off");
    }

    // X-Download-Options (IE)
    if (fullConfig.downloadOptions) {
      res.set("X-Download-Options", "noopen");
    }

    // X-XSS-Protection (legacy)
    if (fullConfig.xssProtection !== undefined) {
      res.set("X-XSS-Protection", fullConfig.xssProtection ? "1; mode=block" : "0");
    }

    // Additional security headers
    res.set("X-Permitted-Cross-Domain-Policies", "none");

    next();
  };
}

/**
 * Create security headers middleware for development
 * Less strict for local development (no HSTS)
 */
export function createDevSecurityHeadersMiddleware() {
  return createSecurityHeadersMiddleware({
    hsts: false, // Don't force HTTPS in development
  });
}
