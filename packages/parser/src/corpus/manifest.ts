import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import type { ComparisonOptions, ComparisonReport } from "../harness/compare.js";
import type { StateSpaceSummary } from "../harness/state-space.js";
import type { JsonValue, StaticRenderStats } from "../types.js";
import type { FrameworkKind } from "../frameworks/framework-profile.js";
import { HOST_PLATFORMS, type HostPlatform } from "../host/host-realm.js";

// A corpus entry pins a real React repository at a revision so the static
// renderer can be validated against the tree its dev server actually commits.

export interface CorpusStaticTarget {
  /** Directory holding the tsconfig used for path aliases; relative to the clone root. */
  rootDirectory: string;
  /** The bundler's served root (Vite `root`) relative to `rootDirectory`, when it is not `rootDirectory`. */
  servedDirectory?: string;
  /** Directory served as-is at the URL root (Vite `publicDir`) relative to `rootDirectory`, when not `public/` under the served root. */
  publicDirectory?: string;
  tsconfig?: string;
  /** The bundler's `resolve.alias`, targets relative to `rootDirectory`. */
  aliases?: Record<string, string>;
  /** Metro platform the web bundle targets (`web`): `name.<platform>.ext` files shadow `name.ext`. */
  platform?: string;
  /** JavaScript host the client code runs on; browser when unset. */
  hostPlatform?: HostPlatform;
  /** SPA only: module containing the `createRoot().render()` call. */
  entry?: string;
  /** Export of `entry` mounted by the boot code when the root render call is not literal. */
  rootComponent?: string;
  /** Framework routers: pathname whose route tree is composed statically. */
  route?: string;
  /** Next: `app/` or `pages/` directory relative to `rootDirectory` when it is not directly under it. */
  appDirectory?: string;
  /** Component name both trees are aligned on before matching. */
  anchor?: string;
  externalPackageAllowList?: string[];
  /** `path#export` functions the boot code calls before mounting, in order. */
  bootstrap?: string[];
  /** `window` properties the served page defines (server-injected config); objects are partial. */
  globals?: Record<string, JsonValue>;
  /** Expressions the dev build inlines (`DefinePlugin`, Vite `define`), keyed by source text. */
  defines?: Record<string, JsonValue>;
  /** dotenv files the server loads, relative to `rootDirectory`, highest precedence first; with them the environment is whole and other variables are unset. */
  envFiles?: string[];
  /** Interpreter step budget per entry (one component render, module initialization or callback). */
  maxSteps?: number;
  /** Bundler prefix of the variables the client bundle inlines (Vite `envPrefix`); defaults to the framework's. */
  envPrefix?: string;
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
  /** `window` properties recorded from the settled page and handed to the static render as `globals` (bootstrap payloads the page fetched). */
  capturedGlobals?: string[];
  static: CorpusStaticTarget;
  compare?: ComparisonOptions;
  notes?: string;
}

interface CorpusManifest {
  entries: CorpusEntry[];
}

const DEFAULT_CORPUS_SETTLE_MS = 3_000;

/** The quiet window the entry's runtime capture waits for, which the static render models timers against. */
export const getSettleMs = (entry: CorpusEntry): number =>
  entry.settleMs ?? DEFAULT_CORPUS_SETTLE_MS;

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

export interface DiagnosticCount {
  code: string;
  count: number;
}

export interface CorpusStaticSummary {
  stats: StaticRenderStats;
  diagnostics: DiagnosticCount[];
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
  /** Null on results recorded before the runtime was matched against an enumerated state space. */
  stateSpace: StateSpaceSummary | null;
  anchor: string | null;
  note: string | null;
  failure: string | null;
}

const jsonRecordSchema = z.record(z.string(), z.json());

const staticTargetSchema: z.ZodType<CorpusStaticTarget> = z.object({
  rootDirectory: z.string(),
  servedDirectory: z.string().optional(),
  tsconfig: z.string().optional(),
  aliases: z.record(z.string(), z.string()).optional(),
  platform: z.string().optional(),
  hostPlatform: z.enum(HOST_PLATFORMS).optional(),
  entry: z.string().optional(),
  rootComponent: z.string().optional(),
  route: z.string().optional(),
  appDirectory: z.string().optional(),
  publicDirectory: z.string().optional(),
  anchor: z.string().optional(),
  externalPackageAllowList: z.array(z.string()).optional(),
  bootstrap: z.array(z.string()).optional(),
  globals: jsonRecordSchema.optional(),
  defines: jsonRecordSchema.optional(),
  envFiles: z.array(z.string()).optional(),
  envPrefix: z.string().optional(),
  maxSteps: z.number().optional(),
  maxFiberCount: z.number().optional(),
  maxComponentDepth: z.number().optional(),
});

const comparisonOptionsSchema: z.ZodType<ComparisonOptions> = z.object({
  compareKeys: z.boolean().optional(),
  compareTags: z.boolean().optional(),
  compareText: z.boolean().optional(),
  maxSteps: z.number().optional(),
});

const entrySchema: z.ZodType<CorpusEntry> = z.object({
  id: z.string(),
  repository: z.string(),
  revision: z.string(),
  description: z.string(),
  framework: z.enum(["spa", "next-app", "next-pages", "react-router"]),
  workingDirectory: z.string(),
  install: z.string(),
  setup: z.array(z.string()).optional(),
  services: z.array(z.string()).optional(),
  dev: z.string(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string(),
  readyTimeoutMs: z.number().optional(),
  waitForSelector: z.string().optional(),
  settleMs: z.number().optional(),
  capturedGlobals: z.array(z.string()).optional(),
  static: staticTargetSchema,
  compare: comparisonOptionsSchema.optional(),
  notes: z.string().optional(),
});

const manifestSchema: z.ZodType<CorpusManifest> = z.object({ entries: z.array(entrySchema) });

export const readCorpusManifest = (manifestPath: string): CorpusManifest =>
  parseWithSchema(manifestSchema, JSON.parse(readFileSync(manifestPath, "utf8")), manifestPath);
