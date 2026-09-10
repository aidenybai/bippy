import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { setTimeout as sleep } from "node:timers/promises";
import { CommandFailedError, CommandTimeoutError, DevServerError } from "../errors.js";

interface DevServerOptions {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  logPath: string;
}

interface RunCommandOptions {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  logPath: string;
  timeoutMs: number;
}

const READY_POLL_INTERVAL_MS = 500;

// Dev servers that only speak https (Sentry's rspack dev-ui) use a self-signed
// certificate, which the global fetch rejects before getting a status code.
const probeStatus = (url: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const request = url.startsWith("https:")
      ? httpsRequest(url, { rejectUnauthorized: false })
      : httpRequest(url);
    request.once("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.once("error", reject);
    request.end();
  });

const isAnswering = async (url: string): Promise<boolean> => {
  try {
    return (await probeStatus(url)) < 500;
  } catch (error) {
    if (getSystemErrorCode(error) === null) throw error;
    return false;
  }
};

const KILL_GRACE_MS = 3_000;
const KILL_POLL_INTERVAL_MS = 100;

// The corpus CLI runs under bippy's pnpm, which advertises itself through
// `npm_config_user_agent` and friends; tools inside a clone (prisma, nx) would
// otherwise shell out to that package manager instead of the clone's own.
const isPackageManagerEnvKey = (key: string): boolean => /^(npm|pnpm)_/i.test(key);

const inheritedEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !isPackageManagerEnvKey(key)));

// Race timers must not keep the process alive once the child has exited.
const deadline = <T>(ms: number, value: T): Promise<T> => sleep(ms, value, { ref: false });

const spawnShell = (
  command: string,
  cwd: string,
  env: Record<string, string> | undefined,
  log: WriteStream,
): ChildProcess => {
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    // Clones live under bippy's tree, whose `packageManager` field would otherwise make
    // corepack refuse the yarn/npm commands the corpus repositories expect.
    env: { ...inheritedEnv(), FORCE_COLOR: "0", CI: "1", COREPACK_ENABLE_STRICT: "0", ...env },
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  return child;
};

const getSystemErrorCode = (error: unknown): string | null =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;

// The group can exit between the liveness check and the signal.
const isMissingProcessError = (error: unknown): boolean => getSystemErrorCode(error) === "ESRCH";

const signalProcessGroup = (pid: number, signal: NodeJS.Signals | 0): boolean => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) return false;
    throw error;
  }
};

// Detached children are their own process group so the whole dev-server tree
// (package manager -> vite/next -> workers) goes away together; the group is
// polled rather than the shell, which exits ahead of servers still shutting down.
const killProcessGroup = async (child: ChildProcess): Promise<void> => {
  if (child.pid === undefined || !signalProcessGroup(child.pid, "SIGTERM")) return;
  const graceDeadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < graceDeadline && signalProcessGroup(child.pid, 0)) {
    await sleep(KILL_POLL_INTERVAL_MS);
  }
  signalProcessGroup(child.pid, "SIGKILL");
};

export const runCommand = async (options: RunCommandOptions): Promise<void> => {
  const log = createWriteStream(options.logPath, { flags: "a" });
  log.write(`\n$ ${options.command}\n`);
  const child = spawnShell(options.command, options.cwd, options.env, log);
  const exit = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => resolveExit(code));
  });
  const outcome = await Promise.race([exit, deadline(options.timeoutMs, "timeout" as const)]);
  if (outcome === "timeout") {
    await killProcessGroup(child);
    log.end();
    throw new CommandTimeoutError(options.command, options.timeoutMs);
  }
  log.end();
  if (outcome !== 0) throw new CommandFailedError(options.command, outcome);
};

export class DevServer {
  private child: ChildProcess | null = null;
  private log: WriteStream | null = null;
  private exitCode: number | null = null;

  constructor(private readonly options: DevServerOptions) {}

  // A capture must come from this entry's server, not whatever an earlier run
  // (or another entry sharing the port) left listening at the same URL.
  async start(url: string): Promise<void> {
    if (await isAnswering(url)) {
      throw new DevServerError(
        `${url} already answers before the dev server started; stop the foreign server first`,
        this.options.logPath,
      );
    }
    this.log = createWriteStream(this.options.logPath, { flags: "a" });
    this.log.write(`\n$ ${this.options.command}\n`);
    this.child = spawnShell(this.options.command, this.options.cwd, this.options.env, this.log);
    this.child.once("exit", (code) => {
      this.exitCode = code ?? -1;
    });
  }

  // Ready means the URL answers at all; dev servers commonly return 404 for the
  // root until their first compile finishes, so any HTTP response counts.
  async waitUntilReady(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exitCode !== null) {
        throw new DevServerError(
          `dev server exited with code ${this.exitCode} before ${url} answered`,
          this.options.logPath,
        );
      }
      if (await isAnswering(url)) return;
      await sleep(READY_POLL_INTERVAL_MS);
    }
    throw new DevServerError(`${url} did not answer within ${timeoutMs}ms`, this.options.logPath);
  }

  async stop(): Promise<void> {
    if (this.child) await killProcessGroup(this.child);
    this.child = null;
    this.log?.end();
    this.log = null;
  }
}
