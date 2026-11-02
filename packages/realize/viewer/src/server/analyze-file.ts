import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { demosSchema, type Demos } from "@/model";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const SOURCE_FILE_PATTERN = /\.tsx?$/;

interface CachedAnalysis {
  modified: number;
  demos: Demos;
}

const cache = new Map<string, CachedAnalysis>();

const viewerRoot = process.cwd();
const packageRoot = resolve(/* turbopackIgnore: true */ viewerRoot, "..");

const getCommand = (absolute: string): [string, string[]] =>
  process.env.NODE_ENV === "development"
    ? [
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
      ]
    : [process.execPath, [".analyzer/analyze-file.mjs", absolute]];

const analyze = async (absolute: string): Promise<Demos> => {
  const [command, commandArguments] = getCommand(absolute);
  const { stdout } = await run(command, commandArguments, {
    cwd: viewerRoot,
    maxBuffer: MAX_BUFFER,
  });
  return demosSchema.parse(JSON.parse(stdout));
};

export const analyzeFile = async (file: string): Promise<Demos | null> => {
  const absolute = resolve(/* turbopackIgnore: true */ packageRoot, file);
  const isPackageSource =
    absolute.startsWith(`${packageRoot}${sep}`) && SOURCE_FILE_PATTERN.test(absolute);
  const stats = isPackageSource
    ? statSync(/* turbopackIgnore: true */ absolute, { throwIfNoEntry: false })
    : undefined;
  if (!stats) return null;
  const modified = stats.mtimeMs;
  const cached = cache.get(absolute);
  if (cached && cached.modified === modified) return cached.demos;
  const demos = await analyze(absolute);
  cache.set(absolute, { modified, demos });
  return demos;
};
