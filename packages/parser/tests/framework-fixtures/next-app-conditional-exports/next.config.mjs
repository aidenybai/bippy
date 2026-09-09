import fs from "fs";
import path from "path";

const CONFIG_CANDIDATES = ["./config/greeting.ts", "./src/config/greeting.ts"];

const configPath = CONFIG_CANDIDATES.find((candidate) => fs.existsSync(path.resolve(candidate)));
if (!configPath) {
  throw new Error("Couldn't find the greeting-kit config file.");
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    resolveAlias: { "greeting-kit/config": configPath },
  },
  webpack(config) {
    config.resolve.alias["greeting-kit/config"] = path.resolve(configPath);
    return config;
  },
};

export default nextConfig;
