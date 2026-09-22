import type { NextConfig } from "next";

const developmentEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

const securityHeaders = [
  { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'${developmentEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:` },
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
] as const;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@dabboba/api-client", "@dabboba/config", "@dabboba/contracts", "@dabboba/ui"],
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  async headers() {
    return [{ source: "/(.*)", headers: [...securityHeaders] }];
  },
};

export default nextConfig;
