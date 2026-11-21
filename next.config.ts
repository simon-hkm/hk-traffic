import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local `next dev` keeps the route handlers. The Cloudflare build sets
  // OUTPUT_EXPORT so the pages become static files and the Worker serves /api.
  ...(process.env.OUTPUT_EXPORT === "1" ? { output: "export" as const } : {}),
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
