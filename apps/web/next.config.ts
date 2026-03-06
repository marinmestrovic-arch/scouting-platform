import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@scouting-platform/contracts",
    "@scouting-platform/core",
    "@scouting-platform/db"
  ]
};

export default nextConfig;
