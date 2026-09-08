import { readFileSync } from "node:fs";
import { z } from "zod";
import type { FrameworkKind } from "../frameworks/framework-profile.js";
import type { ComparisonOptions, ComparisonReport } from "../harness/compare.js";
import { jsonValueSchema } from "../observations.js";
import type { StaticRenderStats } from "../types.js";

// A corpus entry pins a real React repository at a revision so the static
// renderer can be validated against the tree its dev server actually commits.

const frameworkKindSchema: z.ZodType<FrameworkKind> = z.enum([
  "spa",
  "next-app",
  "next-pages",
  "react-router",
]);

const stringRecordSchema = z.record(z.string(), z.string());

const jsonRecordSchema = z.record(z.string(), jsonValueSchema);

const corpusStaticTargetSchema = z.object({
  /** Directory holding the tsconfig used for path aliases; relative to the clone root. */
  rootDirectory: z.string(),
  tsconfig: z.string().optional(),
  /** The bundler's `resolve.alias`, targets relative to `rootDirectory`. */
  aliases: stringRecordSchema.optional(),
  /** SPA only: module containing the `createRoot().render()` call. */
  entry: z.string().optional(),
  /** Export of `entry` mounted by the boot code when the root render call is not literal. */
  rootComponent: z.string().optional(),
  /** Framework routers: pathname whose route tree is composed statically. */
  route: z.string().optional(),
  /** Next: `app/` or `pages/` directory relative to `rootDirectory` when it is not directly under it. */
  appDirectory: z.string().optional(),
  /** Component name both trees are aligned on before matching. */
  anchor: z.string().optional(),
  externalPackageAllowList: z.array(z.string()).optional(),
  /** `path#export` functions the boot code calls before mounting, in order. */
  bootstrap: z.array(z.string()).optional(),
  /** `window` properties the served page defines (server-injected config); objects are partial. */
  globals: jsonRecordSchema.optional(),
  /** Expressions the dev build inlines (`DefinePlugin`, Vite `define`), keyed by source text. */
  defines: jsonRecordSchema.optional(),
  /** dotenv files the server loads, relative to `rootDirectory`; with them the environment is whole and other variables are unset. */
  envFiles: z.array(z.string()).optional(),
  maxFiberCount: z.number().optional(),
  maxComponentDepth: z.number().optional(),
});

const comparisonOptionsSchema: z.ZodType<ComparisonOptions> = z.object({
  compareKeys: z.boolean().optional(),
  compareTags: z.boolean().optional(),
  compareText: z.boolean().optional(),
  maxSteps: z.number().optional(),
});

const corpusEntrySchema = z.object({
  id: z.string(),
  repository: z.string(),
  revision: z.string(),
  description: z.string(),
  framework: frameworkKindSchema,
  /** Where the dev server is started; relative to the clone root. */
  workingDirectory: z.string(),
  /** Run once at the clone root after cloning. */
  install: z.string(),
  /** Commands run once in `workingDirectory` after install (env files, migrations, seeds). */
  setup: z.array(z.string()).optional(),
  /** Idempotent commands run at the clone root before every dev-server start (e.g. a database container). */
  services: z.array(z.string()).optional(),
  dev: z.string(),
  env: stringRecordSchema.optional(),
  url: z.string(),
  readyTimeoutMs: z.number().optional(),
  waitForSelector: z.string().optional(),
  settleMs: z.number().optional(),
  /** `window` properties recorded from the settled page and handed to the static render as `globals` (bootstrap payloads the page fetched). */
  capturedGlobals: z.array(z.string()).optional(),
  static: corpusStaticTargetSchema,
  compare: comparisonOptionsSchema.optional(),
  notes: z.string().optional(),
});

const corpusManifestSchema = z.object({ entries: z.array(corpusEntrySchema) });

export interface CorpusStaticTarget extends z.infer<typeof corpusStaticTargetSchema> {}

export interface CorpusEntry extends z.infer<typeof corpusEntrySchema> {}

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
  anchor: string | null;
  note: string | null;
  failure: string | null;
}

export const readCorpusManifest = (manifestPath: string): CorpusManifest => {
  const manifest = corpusManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (!manifest.success) throw new Error(`${manifestPath}: ${z.prettifyError(manifest.error)}`);
  return manifest.data;
};
