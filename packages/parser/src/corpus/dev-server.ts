import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export interface DevServerOptions {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  logPath: string;
}

export interface RunCommandOptions {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  logPath: string;
  timeoutMs: number;
}

const READY_POLL_INTERVAL_MS = 500;
const KILL_GRACE_MS = 3_000;

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
    env: { ...process.env, ...env, FORCE_COLOR: "0", CI: "1", COREPACK_ENABLE_STRICT: "0" },
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  return child;
};

// Detached children are their own process group so the whole dev-server tree
// (package manager -> vite/next -> workers) goes away together.
const killProcessGroup = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  const timedOut = await Promise.race([exited.then(() => false), deadline(KILL_GRACE_MS, true)]);
  if (timedOut) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      return;
    }
  }
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
    throw new Error(`\`${options.command}\` timed out after ${options.timeoutMs}ms`);
  }
  log.end();
  if (outcome !== 0) throw new Error(`\`${options.command}\` exited with code ${outcome}`);
};

export class DevServer {
  private child: ChildProcess | null = null;
  private log: WriteStream | null = null;
  private exitCode: number | null = null;

  constructor(private readonly options: DevServerOptions) {}

  start(): void {
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
        throw new Error(
          `dev server exited with code ${this.exitCode} before ${url} answered; see ${this.options.logPath}`,
        );
      }
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.status < 500) return;
      } catch {
        // not listening yet
      }
      await sleep(READY_POLL_INTERVAL_MS);
    }
    throw new Error(`${url} did not answer within ${timeoutMs}ms; see ${this.options.logPath}`);
  }

  async stop(): Promise<void> {
    if (this.child) await killProcessGroup(this.child);
    this.child = null;
    this.log?.end();
    this.log = null;
  }
}
