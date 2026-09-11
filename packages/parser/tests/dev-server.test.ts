import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { DevServer, runCommand } from "../src/corpus/dev-server.js";
import type { ChildEnvironment } from "./helpers/child-environment.js";

interface EnvironmentCase {
  name: string;
  environment?: Record<string, string>;
  expectedCI: string | null;
}

const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const CHILD = join(import.meta.dirname, "helpers/child-environment.ts");
const SERVER_CASES: EnvironmentCase[] = [
  { name: "undeclared CI stays unset", expectedCI: null },
  { name: "declared CI is retained", environment: { CI: "declared" }, expectedCI: "declared" },
];
const COMMAND_CASES: EnvironmentCase[] = [
  { name: "commands stay noninteractive", expectedCI: "1" },
  { name: "command overrides are retained", environment: { CI: "0" }, expectedCI: "0" },
];

const withParentEnvironment = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-child-environment-"));
  const inherited = {
    CI: process.env.CI,
    npm_config_user_agent: process.env.npm_config_user_agent,
  };
  process.env.CI = "parent";
  process.env.npm_config_user_agent = "parent-package-manager";
  try {
    await run(directory);
  } finally {
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
};

const getCommand = (capturePath: string): string =>
  [process.execPath, TSX, CHILD, capturePath].map((argument) => JSON.stringify(argument)).join(" ");

const readEnvironment = (capturePath: string): ChildEnvironment =>
  JSON.parse(readFileSync(capturePath, "utf8"));

describe("corpus child environments", () => {
  it.each(SERVER_CASES)(
    "$name",
    async ({ environment, expectedCI }) => {
      await withParentEnvironment(async (directory) => {
        const capturePath = join(directory, "environment.json");
        const server = new DevServer({
          command: `${getCommand(capturePath)} serve`,
          cwd: directory,
          env: environment,
          logPath: join(directory, "server.log"),
        });
        try {
          server.start();
          await expect.poll(() => existsSync(capturePath), { timeout: 5000 }).toBe(true);
          const captured = readEnvironment(capturePath);
          await server.waitUntilReady(`http://127.0.0.1:${captured.port}`, 5000);
          expect(captured.ci).toBe(expectedCI);
          expect(captured.packageManager).toBeNull();
        } finally {
          await server.stop();
        }
      });
    },
    15000,
  );

  it.each(COMMAND_CASES)("$name", async ({ environment, expectedCI }) => {
    await withParentEnvironment(async (directory) => {
      const capturePath = join(directory, "environment.json");
      await runCommand({
        command: getCommand(capturePath),
        cwd: directory,
        env: environment,
        logPath: join(directory, "command.log"),
        timeoutMs: 5000,
      });
      expect(readEnvironment(capturePath)).toEqual({
        ci: expectedCI,
        packageManager: null,
        port: null,
      });
    });
  });
});
