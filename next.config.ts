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
  experimental: {
    serverActions: {
      // Design-prototype HTML can be self-contained (inline CSS/JS/base64 images),
      // so the default 1 MB server-action body limit rejected real uploads (REQ-030).
      // Set above the 25 MB user-facing cap (client-guarded in PrototypeUploadForm)
      // to leave room for the other form fields + multipart overhead.
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
