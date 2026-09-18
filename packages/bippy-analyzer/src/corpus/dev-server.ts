import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createConnection } from "node:net";
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
const probeStatus = (url: string, timeoutMs: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const request = url.startsWith("https:")
      ? httpsRequest(url, { rejectUnauthorized: false, signal })
      : httpRequest(url, { signal });
    request.once("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.once("error", reject);
    request.end();
  });
const KILL_GRACE_MS = 3_000;

// The corpus CLI runs under bippy's pnpm, which advertises itself through
// `npm_config_user_agent` and friends; tools inside a clone (prisma, nx) would
// otherwise shell out to that package manager instead of the clone's own.
const isPackageManagerEnvKey = (key: string): boolean => /^(npm|pnpm)_/i.test(key);

const inheritedEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !isPackageManagerEnvKey(key) && key !== "CI"),
  );

export const getDevServerEnvironment = (env?: Record<string, string>): NodeJS.ProcessEnv => ({
  ...inheritedEnv(),
  FORCE_COLOR: "0",
  COREPACK_ENABLE_STRICT: "0",
  ...env,
});

const NON_INTERACTIVE_ENV: Record<string, string> = { CI: "1" };

// Race timers must not keep the process alive once the child has exited.
const deadline = <T>(ms: number, value: T): Promise<T> => sleep(ms, value, { ref: false });

const spawnShell = (
  command: string,
  cwd: string,
  env: Record<string, string> | undefined,
  log: WriteStream,
  stdin: "ignore" | "pipe" = "ignore",
): ChildProcess => {
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: [stdin, "pipe", "pipe"],
    // Clones live under bippy's tree, whose `packageManager` field would otherwise make
    // corepack refuse the yarn/npm commands the corpus repositories expect.
    env: getDevServerEnvironment(env),
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  return child;
};

const endLog = async (child: ChildProcess, log: WriteStream): Promise<void> => {
  child.stdout?.unpipe(log);
  child.stderr?.unpipe(log);
  await new Promise<void>((resolve, reject) => {
    log.once("error", reject);
    log.end(resolve);
  });
};

const getSystemErrorCode = (error: unknown): string | null =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;

const hasListener = (url: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const address = new URL(url);
    const hostname = address.hostname.startsWith("[")
      ? address.hostname.slice(1, -1)
      : address.hostname;
    const socket = createConnection({
      host: hostname,
      port: Number(address.port || (address.protocol === "https:" ? 443 : 80)),
      signal: AbortSignal.timeout(READY_POLL_INTERVAL_MS),
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (getSystemErrorCode(error) === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });

// The group can exit between the liveness check and the signal.
const isMissingProcessError = (error: unknown): boolean => getSystemErrorCode(error) === "ESRCH";

const signalProcessGroup = (pid: number, signal: NodeJS.Signals): boolean => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) return false;
    throw error;
  }
};

const isChildClosed = (child: ChildProcess): boolean =>
  child.exitCode !== null &&
  (child.stdout === null || child.stdout.closed) &&
  (child.stderr === null || child.stderr.closed);

// Detached children are their own process group so the whole dev-server tree
// (package manager -> vite/next -> workers) goes away together.
const killProcessGroup = async (child: ChildProcess): Promise<void> => {
  if (child.pid === undefined || isChildClosed(child)) return;
  const closed = new Promise<void>((resolveClose) => child.once("close", () => resolveClose()));
  signalProcessGroup(child.pid, "SIGTERM");
  const timedOut = await Promise.race([closed.then(() => false), deadline(KILL_GRACE_MS, true)]);
  if (!timedOut) return;
  signalProcessGroup(child.pid, "SIGKILL");
  await Promise.race([closed, deadline(KILL_GRACE_MS, undefined)]);
};

export const runCommand = async (options: RunCommandOptions): Promise<void> => {
  const log = createWriteStream(options.logPath, { flags: "a" });
  log.write(`\n$ ${options.command}\n`);
  const child = spawnShell(
    options.command,
    options.cwd,
    { ...NON_INTERACTIVE_ENV, ...options.env },
    log,
  );
  const close = new Promise<number | null>((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code) => resolveClose(code));
  });
  const outcome = await Promise.race([close, deadline(options.timeoutMs, "timeout" as const)]);
  if (outcome === "timeout") {
    await killProcessGroup(child);
    await endLog(child, log);
    throw new CommandTimeoutError(options.command, options.timeoutMs);
  }
  await endLog(child, log);
  if (outcome !== 0) throw new CommandFailedError(options.command, outcome);
};

export class DevServer {
  private child: ChildProcess | null = null;
  private log: WriteStream | null = null;
  private exitCode: number | null = null;

  constructor(private readonly options: DevServerOptions) {}

  async start(url?: string): Promise<void> {
    if (url !== undefined && (await hasListener(url))) {
      throw new DevServerError(
        `${url} already has a listener; refusing to start`,
        this.options.logPath,
      );
    }
    this.log = createWriteStream(this.options.logPath, { flags: "a" });
    this.log.write(`\n$ ${this.options.command}\n`);
    this.child = spawnShell(
      this.options.command,
      this.options.cwd,
      this.options.env,
      this.log,
      "pipe",
    );
    this.child.once("exit", (code) => {
      this.exitCode = code ?? -1;
    });
  }

  private assertRunning(url: string): void {
    if (this.exitCode !== null) {
      throw new DevServerError(
        `dev server exited with code ${this.exitCode} before ${url} answered`,
        this.options.logPath,
      );
    }
  }

  async waitUntilReady(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.assertRunning(url);
      try {
        const timeout = Math.max(1, deadline - Date.now());
        const status = await probeStatus(url, timeout);
        this.assertRunning(url);
        if (status < 500) return;
      } catch (error) {
        if (getSystemErrorCode(error) === null) throw error;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await sleep(Math.min(READY_POLL_INTERVAL_MS, remaining));
    }
    throw new DevServerError(`${url} did not answer within ${timeoutMs}ms`, this.options.logPath);
  }

  async stop(): Promise<void> {
    const child = this.child;
    const log = this.log;
    if (child) await killProcessGroup(child);
    child?.stdin?.destroy();
    this.child = null;
    this.log = null;
    if (child && log) await endLog(child, log);
  }
}
