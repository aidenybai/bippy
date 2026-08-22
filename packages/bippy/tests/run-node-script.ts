import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimeResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

export interface RunNodeScriptOptions {
  environment?: NodeJS.ProcessEnv;
  timeout?: number;
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const runNodeScript = (
  script: string,
  options: RunNodeScriptOptions = {},
): RuntimeResult => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      env: { ...process.env, ...options.environment },
      timeout: options.timeout ?? 15_000,
    },
  );
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};
