import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output bundles only the files needed for production,
  // enabling minimal Docker images and faster cold starts.
  output: "standalone",

  // Native password hashing must stay external so Docker/arm64 auth can resolve argon2 bindings.
  serverExternalPackages: ["argon2"],

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "yt3.ggpht.com",
      },
    ],
  },

  transpilePackages: [
    "@scouting-platform/contracts",
    "@scouting-platform/core",
    "@scouting-platform/db",
  ],

  // Aggressive module-level tree-shaking for smaller server bundles.
  experimental: {
    optimizePackageImports: [
      "@scouting-platform/contracts",
      "@scouting-platform/core",
    ],
  },
};

export default nextConfig;
