import { readFileSync } from "node:fs";
import type { ComparisonOptions, ComparisonReport } from "../harness/compare.js";
import type { StaticRenderStats } from "../types.js";
import type { FrameworkKind } from "../frameworks/framework-profile.js";

// A corpus entry pins a real React repository at a revision so the static
// renderer can be validated against the tree its dev server actually commits.

export interface CorpusStaticTarget {
  /** Directory holding the tsconfig used for path aliases; relative to the clone root. */
  rootDirectory: string;
  tsconfig?: string;
  /** SPA only: module containing the `createRoot().render()` call. */
  entry?: string;
  /** Framework routers: pathname whose route tree is composed statically. */
  route?: string;
  /** Next: `app/` or `pages/` directory relative to `rootDirectory` when it is not directly under it. */
  appDirectory?: string;
  /** Component name both trees are aligned on before matching. */
  anchor?: string;
  externalPackageAllowList?: string[];
  maxFiberCount?: number;
  maxComponentDepth?: number;
}

export interface CorpusEntry {
  id: string;
  repository: string;
  revision: string;
  description: string;
  framework: FrameworkKind;
  /** Where the dev server is started; relative to the clone root. */
  workingDirectory: string;
  /** Run once at the clone root after cloning. */
  install: string;
  /** Commands run once in `workingDirectory` after install (env files, migrations, seeds). */
  setup?: string[];
  /** Idempotent commands run at the clone root before every dev-server start (e.g. a database container). */
  services?: string[];
  dev: string;
  env?: Record<string, string>;
  url: string;
  readyTimeoutMs?: number;
  waitForSelector?: string;
  settleMs?: number;
  static: CorpusStaticTarget;
  compare?: ComparisonOptions;
  notes?: string;
}

export interface CorpusManifest {
  entries: CorpusEntry[];
}

export interface CorpusRuntimeSummary {
  reactVersion: string | null;
  rendererName: string | null;
  buildType: "development" | "production" | null;
  roots: number;
  fibers: number;
  commits: number;
  pageErrors: string[];
  title: string;
}

export interface CorpusStaticSummary {
  stats: StaticRenderStats;
  diagnostics: { code: string; count: number }[];
}

export interface CorpusResult {
  id: string;
  revision: string;
  framework: FrameworkKind;
  capturedAt: string;
  durationMs: number;
  runtime: CorpusRuntimeSummary | null;
  static: CorpusStaticSummary | null;
  report: ComparisonReport | null;
  anchor: string | null;
  note: string | null;
  failure: string | null;
}

export const readCorpusManifest = (manifestPath: string): CorpusManifest => {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(`${manifestPath}: expected { entries: CorpusEntry[] }`);
  }
  const entries: CorpusEntry[] = [];
  for (const candidate of parsed.entries) entries.push(validateEntry(candidate, manifestPath));
  return { entries };
};

const FRAMEWORK_KINDS: FrameworkKind[] = ["spa", "next-app", "next-pages", "react-router"];

class ManifestReader {
  constructor(
    private readonly record: Record<string, unknown>,
    private readonly where: string,
  ) {}

  private fail(field: string, expected: string): never {
    throw new Error(`${this.where}: "${field}" must be ${expected}`);
  }

  string(field: string): string {
    const value = this.record[field];
    return typeof value === "string" ? value : this.fail(field, "a string");
  }

  optionalString(field: string): string | undefined {
    const value = this.record[field];
    if (value === undefined) return undefined;
    return typeof value === "string" ? value : this.fail(field, "a string");
  }

  optionalNumber(field: string): number | undefined {
    const value = this.record[field];
    if (value === undefined) return undefined;
    return typeof value === "number" ? value : this.fail(field, "a number");
  }

  optionalBoolean(field: string): boolean | undefined {
    const value = this.record[field];
    if (value === undefined) return undefined;
    return typeof value === "boolean" ? value : this.fail(field, "a boolean");
  }

  optionalStringList(field: string): string[] | undefined {
    const value = this.record[field];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      this.fail(field, "a list of strings");
    }
    return value.filter((item): item is string => typeof item === "string");
  }

  optionalStringRecord(field: string): Record<string, string> | undefined {
    const value = this.record[field];
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.fail(field, "an object of strings");
    }
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string") this.fail(`${field}.${key}`, "a string");
      result[key] = item;
    }
    return result;
  }

  object(field: string): ManifestReader {
    const value = this.record[field];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.fail(field, "an object");
    }
    return new ManifestReader({ ...value }, `${this.where}.${field}`);
  }

  optionalObject(field: string): ManifestReader | undefined {
    return this.record[field] === undefined ? undefined : this.object(field);
  }
}

const readFramework = (reader: ManifestReader): FrameworkKind => {
  const value = reader.string("framework");
  const kind = FRAMEWORK_KINDS.find((candidate) => candidate === value);
  if (!kind)
    throw new Error(`unknown framework "${value}"; expected ${FRAMEWORK_KINDS.join(", ")}`);
  return kind;
};

const readStaticTarget = (reader: ManifestReader): CorpusStaticTarget => ({
  rootDirectory: reader.string("rootDirectory"),
  tsconfig: reader.optionalString("tsconfig"),
  entry: reader.optionalString("entry"),
  route: reader.optionalString("route"),
  appDirectory: reader.optionalString("appDirectory"),
  anchor: reader.optionalString("anchor"),
  externalPackageAllowList: reader.optionalStringList("externalPackageAllowList"),
  maxFiberCount: reader.optionalNumber("maxFiberCount"),
  maxComponentDepth: reader.optionalNumber("maxComponentDepth"),
});

const readComparisonOptions = (reader: ManifestReader): ComparisonOptions => ({
  compareKeys: reader.optionalBoolean("compareKeys"),
  compareTags: reader.optionalBoolean("compareTags"),
  compareText: reader.optionalBoolean("compareText"),
  maxSteps: reader.optionalNumber("maxSteps"),
});

const validateEntry = (candidate: unknown, manifestPath: string): CorpusEntry => {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error(`${manifestPath}: corpus entry must be an object`);
  }
  const record: Record<string, unknown> = { ...candidate };
  const reader = new ManifestReader(record, `${manifestPath} entry ${String(record.id)}`);
  const compare = reader.optionalObject("compare");
  return {
    id: reader.string("id"),
    repository: reader.string("repository"),
    revision: reader.string("revision"),
    description: reader.string("description"),
    framework: readFramework(reader),
    workingDirectory: reader.string("workingDirectory"),
    install: reader.string("install"),
    setup: reader.optionalStringList("setup"),
    services: reader.optionalStringList("services"),
    dev: reader.string("dev"),
    env: reader.optionalStringRecord("env"),
    url: reader.string("url"),
    readyTimeoutMs: reader.optionalNumber("readyTimeoutMs"),
    waitForSelector: reader.optionalString("waitForSelector"),
    settleMs: reader.optionalNumber("settleMs"),
    static: readStaticTarget(reader.object("static")),
    compare: compare ? readComparisonOptions(compare) : undefined,
    notes: reader.optionalString("notes"),
  };
};
