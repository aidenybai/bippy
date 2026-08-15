import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const bippySourcePath = fileURLToPath(new URL("../bippy/src/index.ts", import.meta.url));

const nextConfig: NextConfig = {
  webpack: (config, { dev }) => {
    if (dev) {
      config.resolve.extensionAlias = {
        ...config.resolve.extensionAlias,
        ".js": [".ts", ".tsx", ".js"],
      };
      config.resolve.alias = {
        ...config.resolve.alias,
        bippy$: bippySourcePath,
      };
    }

    return config;
  },
};

export default nextConfig;
