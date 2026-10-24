import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { demosSchema, type Demos } from "@/model";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

interface CachedAnalysis {
  modified: number;
  demos: Demos;
}

const cache = new Map<string, CachedAnalysis>();

const analyze = async (absolute: string): Promise<Demos> => {
  const { stdout } = await run(
    "pnpm",
    [
      "-s",
      "exec",
      "tsx",
      "--tsconfig",
      "generate/tsconfig.json",
      "generate/analyze-file.ts",
      absolute,
    ],
    { cwd: process.cwd(), maxBuffer: MAX_BUFFER },
  );
  return demosSchema.parse(JSON.parse(stdout));
};

export const analyzeFile = async (file: string): Promise<Demos | null> => {
  if (process.env.NODE_ENV !== "development") return null;
  const absolute = resolve(process.cwd(), "..", file);
  if (!existsSync(absolute)) return null;
  const modified = statSync(absolute).mtimeMs;
  const cached = cache.get(absolute);
  if (cached && cached.modified === modified) return cached.demos;
  const demos = await analyze(absolute);
  cache.set(absolute, { modified, demos });
  return demos;
};
