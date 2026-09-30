import type { NextConfig } from "next";

// The Content-Security-Policy header is issued per request by proxy.ts so its
// script-src can allow scripts by nonce rather than allowing all inline code.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
] as const;

const noStore = { key: "Cache-Control", value: "private, no-store, max-age=0" } as const;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@dabboba/api-client", "@dabboba/config", "@dabboba/contracts", "@dabboba/ui"],
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  async headers() {
    return [
      { source: "/(.*)", headers: [...securityHeaders] },
      // Content-hashed build assets keep Next.js's immutable caching; every
      // other console response is private and never stored.
      { source: "/((?!_next/static/).*)", headers: [noStore] },
    ];
  },
};

export default nextConfig;
