import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResolverConfigurationError } from "../errors.js";
import type { ResolverConfig } from "./read-resolver-config.js";

export interface NextConfigRequest {
  configFile: string;
  platform: "browser" | "node";
  mode: "development" | "production";
}

export interface NextConfigWorkerRequest extends NextConfigRequest {
  outputFile: string;
}

export interface NextResolverConfig {
  version: string;
  configFile: string;
  output?: string;
  import: ResolverConfig;
  require: ResolverConfig;
}

const require = createRequire(import.meta.url);

export const loadNextConfig = (
  request: NextConfigRequest,
  timeoutMs: number,
): NextResolverConfig => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-next-config-"));
  const outputFile = join(directory, "policy.json");
  try {
    const child = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=512",
        "--import",
        require.resolve("tsx"),
        fileURLToPath(new URL("./next-config-worker.ts", import.meta.url)),
        JSON.stringify({ ...request, outputFile }),
      ],
      {
        cwd: dirname(request.configFile),
        env: {
          HOME: directory,
          NODE_ENV: request.mode,
          NEXT_TELEMETRY_DISABLED: "1",
          RAYON_NUM_THREADS: "2",
        },
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      },
    );
    if (child.error) throw child.error;
    if (child.status !== 0)
      throw new Error(
        `Next configuration worker failed (${child.signal ?? child.status}): ${child.stderr}`,
      );
    if (statSync(outputFile).size > 1024 * 1024)
      throw new Error("Next configuration output exceeds 1 MiB");
    const configuration: NextResolverConfig = JSON.parse(readFileSync(outputFile, "utf8"));
    if (
      configuration.configFile !== request.configFile ||
      !configuration.import ||
      !configuration.require
    )
      throw new Error("Invalid Next configuration response");
    configuration.output = [child.stdout, child.stderr].filter(Boolean).join("\n").trim();
    return configuration;
  } catch (error) {
    throw new ResolverConfigurationError(
      `Cannot load Next configuration ${request.configFile}`,
      error,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
