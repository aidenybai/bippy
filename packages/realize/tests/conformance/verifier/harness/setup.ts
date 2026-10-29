import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

export interface HarnessSetup {
  file: string | null;
  env: Record<string, string>;
  alias: Record<string, string>;
}

const HARNESS_CONFIG_SCHEMA = z.object({
  env: z.record(z.string(), z.string()).optional(),
  alias: z.record(z.string(), z.string()).optional(),
});

const SETUP_FILE = "setup.tsx";
const HARNESS_CONFIG_FILE = "harness.json";

export const readHarnessSetup = (directory: string | null): HarnessSetup => {
  if (!directory) return { file: null, env: {}, alias: {} };
  const setupFile = join(directory, SETUP_FILE);
  const configFile = join(directory, HARNESS_CONFIG_FILE);
  const config = existsSync(configFile)
    ? HARNESS_CONFIG_SCHEMA.parse(JSON.parse(readFileSync(configFile, "utf8")))
    : {};
  return {
    file: existsSync(setupFile) ? setupFile : null,
    env: config.env ?? {},
    alias: Object.fromEntries(
      Object.entries(config.alias ?? {}).map(([source, target]) => [
        source,
        target.startsWith(".") ? resolve(directory, target) : target,
      ]),
    ),
  };
};
