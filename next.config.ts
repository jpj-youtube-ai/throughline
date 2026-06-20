import type { NextConfig } from "next";

// In dev behind a proxy (e.g. Tailscale Serve / Funnel), the browser's origin is
// the public host, not localhost — allow it to reach Next's dev resources (HMR,
// error overlay, server actions). Derived from AUTH_URL so it isn't hardcoded.
const allowedDevOrigins: string[] = [];
try {
  if (process.env.AUTH_URL) allowedDevOrigins.push(new URL(process.env.AUTH_URL).host);
} catch {
  // ignore a malformed AUTH_URL
}

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
