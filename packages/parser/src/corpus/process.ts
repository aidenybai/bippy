import { type ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Runs a command to completion, returning stdout; failures include the command and stderr. */
export const runCommand = async (
  file: string,
  args: string[],
  options: RunOptions,
): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      timeout: options.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`${file} ${args.join(" ")} failed in ${options.cwd}\n${stderr}`.trim());
  }
};

/** Runs a shell command line (as written in corpus metadata) to completion. */
export const runShell = (commandLine: string, options: RunOptions): Promise<string> =>
  runCommand("sh", ["-c", commandLine], options);

export interface BackgroundProcess {
  process: ChildProcess;
  /** Combined stdout and stderr so far. */
  getOutput: () => string;
  /** Resolves when the process exits, with its code (or `null` when killed by a signal). */
  exited: Promise<number | null>;
  /** Terminates the whole process group so shell-spawned children die with it. */
  stop: () => Promise<void>;
}

const KILL_GRACE_MS = 5_000;
const MAX_OUTPUT_CHARS = 200_000;

/**
 * Starts a long-running shell command in its own process group, capturing
 * output for diagnostics. Package-manager wrappers spawn the real server as
 * a child, so stopping must signal the group rather than the leader.
 */
export const startBackgroundProcess = (
  commandLine: string,
  options: RunOptions,
): BackgroundProcess => {
  const child = spawn("sh", ["-c", commandLine], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer): void => {
    output = (output + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  const signalGroup = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  return {
    process: child,
    getOutput: () => output,
    exited,
    stop: async () => {
      if (child.exitCode !== null) return;
      signalGroup("SIGTERM");
      const timer = setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
      await exited;
      clearTimeout(timer);
    },
  };
};
