import { existsSync } from "node:fs";
import { join } from "node:path";
import { type BackgroundProcess, runShell, startBackgroundProcess } from "./process.js";
import type { CorpusCheckout, LiveTarget } from "./repositories.js";

export interface DevServer {
  url: string;
  stop: () => Promise<void>;
  getOutput: () => string;
}

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 500;

/** Environment that keeps dev servers from opening browsers or waiting on a TTY. */
const SERVER_ENVIRONMENT: NodeJS.ProcessEnv = {
  ...process.env,
  BROWSER: "none",
  CI: "1",
  FORCE_COLOR: "0",
  NO_COLOR: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isServing = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(POLL_INTERVAL_MS * 4) });
    return response.status < 500;
  } catch {
    return false;
  }
};

const waitUntilServing = async (
  url: string,
  server: BackgroundProcess,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.process.exitCode !== null) {
      throw new Error(
        `dev server exited with code ${server.process.exitCode} before serving ${url}\n${server.getOutput()}`,
      );
    }
    if (await isServing(url)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`dev server did not serve ${url} within ${timeoutMs}ms\n${server.getOutput()}`);
};

/** Runs the target's install command unless its dependencies are already present. */
export const installDependencies = async (
  checkout: CorpusCheckout,
  target: LiveTarget,
  onLog?: (message: string) => void,
): Promise<void> => {
  if (target.installCommand === null) return;
  const installedMarkers = [
    join(checkout.rootDirectory, "node_modules"),
    join(checkout.rootDirectory, checkout.appDirectory, "node_modules"),
  ];
  if (installedMarkers.some((marker) => existsSync(marker))) {
    onLog?.("dependencies already installed");
    return;
  }
  onLog?.(`installing: ${target.installCommand}`);
  await runShell(target.installCommand, {
    cwd: checkout.rootDirectory,
    env: SERVER_ENVIRONMENT,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
};

export const getLiveUrl = (target: LiveTarget): string =>
  `http://127.0.0.1:${target.port}${target.path ?? "/"}`;

/** Starts the target's dev server and resolves once it answers HTTP requests. */
export const startDevServer = async (
  checkout: CorpusCheckout,
  target: LiveTarget,
): Promise<DevServer> => {
  const url = getLiveUrl(target);
  const server = startBackgroundProcess(target.devCommand, {
    cwd: checkout.rootDirectory,
    env: SERVER_ENVIRONMENT,
  });
  try {
    await waitUntilServing(url, server, target.readyTimeoutMs);
  } catch (error) {
    await server.stop();
    throw error;
  }
  return { url, stop: server.stop, getOutput: server.getOutput };
};
