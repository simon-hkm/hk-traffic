import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static files only, so the public site can sit on the Workers free plan
  // without spending the daily request quota on page views.
  output: "export",
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
