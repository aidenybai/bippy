import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, get, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vite-plus/test";
import { DevServer, runCommand } from "../src/corpus/dev-server.js";
import { DevServerError } from "../src/errors.js";
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

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
};

const readResponse = (url: string): Promise<string> =>
  new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.once("end", () => resolve(body));
      response.once("error", reject);
    }).once("error", reject);
  });

const close = async (server: Server): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

describe("corpus server startup", () => {
  it.each([200, 503, null])(
    "rejects an existing listener with status %s before starting",
    async (status) => {
      await withParentEnvironment(async (directory) => {
        let requestCount = 0;
        const existing = createServer((_request, response) => {
          requestCount++;
          if (status !== null) {
            response.statusCode = status;
            response.end("unrelated service");
          }
        });
        const url = await listen(existing);
        const capturePath = join(directory, "child.json");
        const server = new DevServer({
          command: `${getCommand(capturePath)} serve`,
          cwd: directory,
          logPath: join(directory, "server.log"),
        });
        try {
          await expect(async () => {
            await server.start(url);
          }).rejects.toThrow("already has a listener");
          expect(existsSync(capturePath)).toBe(false);
          expect(requestCount).toBe(0);
          expect(existing.listening).toBe(true);
        } finally {
          await server.stop();
          await close(existing);
        }
      });
    },
  );

  it("starts a child on an available address", async () => {
    await withParentEnvironment(async (directory) => {
      const reservation = createServer();
      const url = await listen(reservation);
      await close(reservation);
      const capturePath = join(directory, "child.json");
      const server = new DevServer({
        command: `${getCommand(capturePath)} serve ${new URL(url).port}`,
        cwd: directory,
        logPath: join(directory, "server.log"),
      });
      try {
        await server.start(url);
        await server.waitUntilReady(url, 5000);
        expect(readEnvironment(capturePath).port).toBe(Number(new URL(url).port));
      } finally {
        await server.stop();
      }
    });
  });

  it("keeps server stdin open without setting CI and closes the owned server on stop", async () => {
    await withParentEnvironment(async (directory) => {
      const capturePath = join(directory, "child.json");
      const server = new DevServer({
        command: `${getCommand(capturePath)} serve-stdin`,
        cwd: directory,
        logPath: join(directory, "server.log"),
      });
      let url: string | null = null;
      try {
        await server.start();
        await expect.poll(() => existsSync(capturePath), { timeout: 5000 }).toBe(true);
        const captured = readEnvironment(capturePath);
        expect(captured.ci).toBeNull();
        url = `http://127.0.0.1:${captured.port}`;
        await server.waitUntilReady(url, 5000);
        expect(await readResponse(url)).toBe("ready");
      } finally {
        await server.stop();
      }
      expect(url).not.toBeNull();
      if (url !== null)
        await expect(readResponse(url)).rejects.toMatchObject({ code: "ECONNREFUSED" });
    });
  });

  it("rejects a response received after the child exits", async () => {
    await withParentEnvironment(async (directory) => {
      const server = new DevServer({
        command: `${getCommand(join(directory, "child.json"))} serve`,
        cwd: directory,
        logPath: join(directory, "server.log"),
      });
      const responder = createServer(async (_request, response) => {
        await server.stop();
        response.end("too late");
      });
      const url = await listen(responder);
      try {
        await server.start();
        await expect(server.waitUntilReady(url, 5000)).rejects.toThrow("dev server exited");
      } finally {
        await server.stop();
        await close(responder);
      }
    });
  });

  it("accepts a healthy response slower than the polling interval", async () => {
    await withParentEnvironment(async (directory) => {
      const responder = createServer(async (_request, response) => {
        await sleep(750);
        response.end("ready");
      });
      const url = await listen(responder);
      const server = new DevServer({
        command: `${getCommand(join(directory, "child.json"))} serve`,
        cwd: directory,
        logPath: join(directory, "server.log"),
      });
      try {
        await server.start();
        await expect(server.waitUntilReady(url, 2500)).resolves.toBeUndefined();
      } finally {
        await server.stop();
        await close(responder);
      }
    });
  });

  it("bounds a readiness probe that never sends headers", async () => {
    await withParentEnvironment(async (directory) => {
      const unresponsive = createServer(() => {});
      const url = await listen(unresponsive);
      const server = new DevServer({
        command: `${getCommand(join(directory, "child.json"))} serve`,
        cwd: directory,
        logPath: join(directory, "server.log"),
      });
      try {
        await server.start();
        const result = await Promise.race([
          server.waitUntilReady(url, 100).then(
            () => "ready",
            (error: unknown) => error,
          ),
          sleep(1000, "unbounded", { ref: false }),
        ]);
        expect(result).toBeInstanceOf(DevServerError);
        expect(result).toMatchObject({
          message: expect.stringContaining("did not answer within 100ms"),
        });
      } finally {
        await server.stop();
        await close(unresponsive);
      }
    });
  });
});

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
          await server.start();
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

  it("still sends stdin EOF to noninteractive commands", async () => {
    await withParentEnvironment(async (directory) => {
      const capturePath = join(directory, "environment.json");
      await runCommand({
        command: `${getCommand(capturePath)} stdin-end`,
        cwd: directory,
        logPath: join(directory, "command.log"),
        timeoutMs: 5000,
      });
      expect(readEnvironment(capturePath).ci).toBe("1");
    });
  });

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
