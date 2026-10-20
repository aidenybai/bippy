import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  reactCompiler: true,
  allowedDevOrigins: ["macmini", "macmini.tail5e921d.ts.net", "100.111.151.66"],
};

export default nextConfig;
