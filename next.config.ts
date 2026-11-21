import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The schedule and snapshot caches live in route handlers, so the app
  // needs the Next.js server. A static export would send every visitor
  // straight to the government endpoints.
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
