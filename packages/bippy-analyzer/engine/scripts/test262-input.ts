import { createHash } from "node:crypto";
import { parse } from "yaml";

export const test262Revision = "045bf6f9966ce3291b8fbc1e0403cd97b9201b00";
export const defaultScopes = [
  "built-ins/Object/isFrozen",
  "built-ins/Object/seal",
  "language/statements/try",
  "language/statements/for-of",
];

export interface TestMetadata {
  flags: string[];
  includes: string[];
  negative?: { phase: string; type: string };
}

export const test262JobLimit = 10_000;
export const test262ModuleLimit = 512;
export const test262ModuleByteLimit = 4 * 1024 * 1024;

export interface ModuleSource {
  path: string;
  sourceHash: string;
}

export interface TestOutcome {
  status: "passed" | "failed" | "unsupported" | "harness-error" | "engine-error" | "incomplete";
  detail?: string;
  unhandledRejections?: number;
  moduleSources?: ModuleSource[];
}

export interface TestResult extends TestOutcome {
  path: string;
  sourceHash: string;
  mode: string;
}

export interface Test262Options {
  directory: string;
  all: boolean;
  scopes: string[];
  shard: { index: number; total: number };
  list: boolean;
  timeoutMs: number;
}

const positiveInteger = (value: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > maximum)
    throw new Error(`Invalid positive integer: ${value}`);
  return number;
};

export const parseTest262Options = (arguments_: string[]): Test262Options => {
  const directory = arguments_[0];
  if (!directory || directory.startsWith("--"))
    throw new Error("Supply a clean Test262 checkout directory");
  const options: Test262Options = {
    directory,
    all: false,
    scopes: [],
    shard: { index: 1, total: 1 },
    list: false,
    timeoutMs: 60_000,
  };
  for (let index = 1; index < arguments_.length; index++) {
    const flag = arguments_[index];
    if (flag === "--all") options.all = true;
    else if (flag === "--list") options.list = true;
    else if (flag === "--scope" || flag === "--shard" || flag === "--timeout") {
      const value = arguments_[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      if (flag === "--scope") {
        const scope = value.replaceAll("\\", "/").replace(/\/$/, "");
        if (
          scope.split("/").some((part) => !part || part === "." || part === "..") ||
          scope.includes(":")
        )
          throw new Error(`Invalid test scope: ${value}`);
        options.scopes.push(scope);
      } else if (flag === "--timeout") options.timeoutMs = positiveInteger(value, 2_147_483_647);
      else {
        const parts = value.split("/");
        if (parts.length !== 2) throw new Error("Shards must use INDEX/TOTAL");
        options.shard = { index: positiveInteger(parts[0]), total: positiveInteger(parts[1]) };
        if (options.shard.index > options.shard.total) throw new Error("Shard index exceeds total");
      }
    } else throw new Error(`Unknown Test262 option: ${flag}`);
  }
  if (options.all && options.scopes.length) throw new Error("Choose --all or --scope, not both");
  return options;
};

export const selectTest262Files = (paths: readonly string[], options: Test262Options) => {
  const allFiles = paths
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".js"));
  const eligible = allFiles.filter(
    (path) => !path.slice(path.lastIndexOf("/") + 1).includes("_FIXTURE"),
  );
  const matching = eligible.filter(
    (path) =>
      options.all ||
      (options.scopes.length
        ? options.scopes.some((scope) => path === scope || path.startsWith(`${scope}/`))
        : defaultScopes.some((scope) => path.slice(0, path.lastIndexOf("/")) === scope) ||
          /(?:^|\/)tco(?:-[^/]+)?\.js$/.test(path)),
  );
  const files = matching
    .filter(
      (path) =>
        createHash("sha256").update(path).digest().readUInt32BE(0) % options.shard.total ===
        options.shard.index - 1,
    )
    .sort();
  return {
    files,
    discoveredFiles: allFiles.length,
    fixtureFiles: allFiles.length - eligible.length,
    scopeExcludedFiles: eligible.length - matching.length,
    shardExcludedFiles: matching.length - files.length,
    excludedFiles: allFiles.length - files.length,
    matchingFiles: matching.length,
  };
};

const strings = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string"))
    throw new Error("Expected a string list in Test262 metadata");
  return value;
};

export const metadataOf = (source: string): TestMetadata => {
  const header = source.match(/\/\*---([\s\S]*?)---\*\//)?.[1];
  if (!header) throw new Error("Missing Test262 metadata");
  const data: unknown = parse(header);
  if (!data || typeof data !== "object") throw new Error("Invalid Test262 metadata");
  const metadata: TestMetadata = {
    flags: strings(Reflect.get(data, "flags")),
    includes: strings(Reflect.get(data, "includes")),
  };
  if (
    metadata.flags.includes("onlyStrict") &&
    metadata.flags.some((flag) => flag === "noStrict" || flag === "raw")
  )
    throw new Error("Conflicting strictness flags");
  if (
    metadata.flags.includes("module") &&
    metadata.flags.some((flag) => ["noStrict", "onlyStrict"].includes(flag))
  )
    throw new Error("Conflicting module execution flags");
  const negative: unknown = Reflect.get(data, "negative");
  if (negative !== undefined) {
    if (!negative || typeof negative !== "object")
      throw new Error("Invalid negative test metadata");
    const phase: unknown = Reflect.get(negative, "phase");
    const type: unknown = Reflect.get(negative, "type");
    if (typeof phase !== "string" || typeof type !== "string")
      throw new Error("Invalid negative phase/type");
    metadata.negative = { phase, type };
  }
  return metadata;
};

export const getUnsupportedReason = (path: string, metadata: TestMetadata): string | undefined => {
  if (path.startsWith("intl402/") || path.startsWith("staging/intl402/"))
    return "Raw engine runner does not implement the ECMA-402 profile";
  if (
    metadata.flags.some(
      (flag) => !["onlyStrict", "noStrict", "raw", "generated", "async", "module"].includes(flag),
    ) ||
    (metadata.negative &&
      !["parse", "early", "runtime", "resolution"].includes(metadata.negative.phase))
  )
    return `flags=${metadata.flags.join(",")}; negative=${metadata.negative?.phase ?? "none"}`;
  if (metadata.negative?.phase === "resolution" && !metadata.flags.includes("module"))
    return "Resolution-negative tests require module execution";
  if (metadata.flags.includes("async") && metadata.negative?.phase === "runtime")
    return "Async runtime-negative completion protocol is not implemented";
  return undefined;
};

export const getTestModes = (metadata: TestMetadata): string[] =>
  metadata.flags.includes("module")
    ? ["module"]
    : metadata.flags.includes("onlyStrict")
      ? ["strict"]
      : metadata.flags.some((flag) => flag === "noStrict" || flag === "raw")
        ? ["sloppy"]
        : ["sloppy", "strict"];
