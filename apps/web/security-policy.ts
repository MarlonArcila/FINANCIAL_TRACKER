const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "frame-src https://whop.com https://*.whop.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "upgrade-insecure-requests",
] as const;

export const contentSecurityPolicy = cspDirectives.join("; ");
export const metaContentSecurityPolicy = cspDirectives
  .filter((directive) => !directive.startsWith("frame-ancestors"))
  .join("; ");

export const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": contentSecurityPolicy,
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};
