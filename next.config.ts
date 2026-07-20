import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits `.next/standalone` (minimal server + traced deps) for the Docker build.
  output: "standalone",
};

export default nextConfig;
