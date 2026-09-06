import { join } from "node:path";
import { AnalysisTimeoutError } from "../analyze/interpreter.js";
import { isComponentName } from "../analyze/naming.js";
import {
  describeValue,
  getValueName,
  object,
  type ObjectValue,
  type StaticValue,
} from "../analyze/values.js";
import type { StaticNode } from "../fiber/types.js";
import { DEFAULT_EXPORT_NAME, type ModuleEnvironment, type ParsedModule } from "../module/types.js";
import { createStaticRenderer, type StaticRenderer, type StaticRenderResult } from "../renderer.js";
import { renderSnapshotTree } from "../snapshot/render.js";
import type { CorpusCheckout, CorpusFramework } from "./repositories.js";
import { listSourceFiles } from "./sources.js";

export interface ScanOptions {
  /** Link into `node_modules`; needs the checkout's dependencies installed. */
  followExternalModules: boolean;
  /** Fiber budget per component tree. */
  maxFiberCount: number;
  /** Wall-clock budget per component tree. */
  timeBudgetMs: number;
  /** Stop after this many components; `0` scans them all. */
  maxComponents: number;
  onProgress?: (message: string) => void;
}

export type ComponentKind = "function" | "class" | "memo" | "forwardRef" | "lazy";

export type ComponentScanStatus = "rendered" | "crashed" | "timed-out";

export interface ComponentScan {
  /** Relative to the checkout root. */
  filePath: string;
  exportName: string;
  name: string | null;
  /** `null` when evaluating the export crashed before it could be classified. */
  kind: ComponentKind | null;
  status: ComponentScanStatus;
  fiberCount: number;
  unknownCount: number;
  /** Fibers whose implementation is outside the analyzed graph. */
  opaqueCount: number;
  hookCount: number;
  durationMs: number;
  /** Message of the analyzer exception, unless `rendered`. */
  error: string | null;
}

export interface ReasonCount {
  reason: string;
  count: number;
}

export interface ImportStats {
  total: number;
  /** Resolved to a project module. */
  internal: number;
  /** Resolved into `node_modules` or a Node builtin. */
  external: number;
  unresolved: number;
  /** Specifiers that resolved to nothing, most frequent first. */
  unresolvedSpecifiers: ReasonCount[];
}

export interface EntryTree {
  filePath: string;
  /** `mount` for `createRoot().render(...)`, `export` for the default export. */
  source: "mount" | "export";
  fiberCount: number;
  unknownCount: number;
  tree: string;
}

export interface RepositoryScan {
  name: string;
  commit: string | null;
  framework: CorpusFramework;
  reactVersion: string;
  appDirectory: string;
  files: {
    total: number;
    parsed: number;
    /** Modules Oxc reported at least one syntax error for. */
    withErrors: number;
    byEnvironment: Record<ModuleEnvironment, number>;
  };
  imports: ImportStats;
  components: {
    found: number;
    rendered: number;
    crashed: number;
    timedOut: number;
    /** Rendered without a single unknown or opaque node. */
    fullyKnown: number;
    fibers: number;
    unknowns: number;
    opaque: number;
  };
  tags: Record<string, number>;
  diagnostics: Record<string, number>;
  /** Most common diagnostic messages, e.g. the free identifiers nothing declares. */
  diagnosticMessages: ReasonCount[];
  /** Most common descriptions of children the analysis gave up on. */
  unknownReasons: ReasonCount[];
  /** Packages whose components appear as opaque fibers most often. */
  opaquePackages: ReasonCount[];
  /** Analyzer exceptions grouped by message; each one is a bug. */
  crashes: ReasonCount[];
  entries: EntryTree[];
  componentList: ComponentScan[];
  durationMs: number;
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  followExternalModules: false,
  maxFiberCount: 5_000,
  timeBudgetMs: 10_000,
  maxComponents: 0,
};

const TOP_REASONS = 40;
const MAX_REASON_LENGTH = 120;

interface Histogram {
  counts: Map<string, number>;
}

const createHistogram = (): Histogram => ({ counts: new Map() });

const count = (histogram: Histogram, key: string): void => {
  histogram.counts.set(key, (histogram.counts.get(key) ?? 0) + 1);
};

const topReasons = (histogram: Histogram, limit = TOP_REASONS): ReasonCount[] =>
  [...histogram.counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([reason, total]) => ({ reason, count: total }));

const toRecord = (histogram: Histogram): Record<string, number> =>
  Object.fromEntries([...histogram.counts].sort((left, right) => right[1] - left[1]));

const truncate = (value: string): string => {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_REASON_LENGTH
    ? `${collapsed.slice(0, MAX_REASON_LENGTH - 1)}…`
    : collapsed;
};

interface TreeStats {
  fibers: number;
  unknowns: number;
  opaque: number;
}

interface Histograms {
  tags: Histogram;
  unknownReasons: Histogram;
  opaquePackages: Histogram;
}

const describeOpaqueSource = (type: StaticValue | null): string => {
  if (type?.kind === "external") return type.packageName ?? type.specifier;
  return type ? truncate(describeValue(type)) : "unknown type";
};

const collectTreeStats = (nodes: StaticNode[], stats: TreeStats, histograms: Histograms): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        stats.fibers++;
        if (node.tag === null) {
          stats.opaque++;
          count(histograms.tags, "Opaque");
          count(histograms.opaquePackages, describeOpaqueSource(node.type));
        } else {
          count(histograms.tags, node.tag);
        }
        collectTreeStats(node.children, stats, histograms);
        if (node.fallback) collectTreeStats(node.fallback, stats, histograms);
        break;
      case "branch":
        for (const alternative of node.alternatives)
          collectTreeStats(alternative, stats, histograms);
        break;
      case "list":
        collectTreeStats(node.items, stats, histograms);
        break;
      case "unknown":
        stats.unknowns++;
        count(histograms.unknownReasons, truncate(node.description));
        break;
    }
  }
};

const getComponentKind = (value: StaticValue, exportName: string): ComponentKind | null => {
  if (value.kind === "function") {
    const name = value.name ?? exportName;
    return isComponentName(name) ? "function" : null;
  }
  if (value.kind !== "component") return null;
  switch (value.definition.kind) {
    case "class":
    case "memo":
    case "forwardRef":
    case "lazy":
      return value.definition.kind;
    default:
      return null;
  }
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const countImports = (
  renderer: StaticRenderer,
  module: ParsedModule,
  imports: ImportStats,
  unresolvedSpecifiers: Histogram,
): void => {
  const requests = new Set<string>();
  for (const binding of module.bindings.values()) {
    if (binding.kind === "import" && !binding.isTypeOnly) requests.add(binding.moduleRequest);
  }
  for (const named of module.exports.named.values()) {
    if (named.kind === "reexport") requests.add(named.moduleRequest);
  }
  for (const star of module.exports.stars) requests.add(star.moduleRequest);
  for (const request of requests) {
    imports.total++;
    const resolved = renderer.project.resolveSpecifier(module.filePath, request);
    if (!resolved) {
      imports.unresolved++;
      count(unresolvedSpecifiers, request);
    } else if (resolved.isExternal) imports.external++;
    else imports.internal++;
  }
};

/** Component props are unknown at scan time: every read yields an unknown value. */
const UNKNOWN_PROPS: ObjectValue = object([], true);

/**
 * Evaluates one export and, when it is a component, renders it. Returns
 * `null` for exports that are not components; a crash while evaluating the
 * export is still reported, since it may hide a component.
 */
const scanExport = (
  renderer: StaticRenderer,
  module: ParsedModule,
  exportName: string,
  relativePath: string,
  histograms: Histograms,
): ComponentScan | null => {
  const startedAt = performance.now();
  const scan: ComponentScan = {
    filePath: relativePath,
    exportName,
    name: exportName === DEFAULT_EXPORT_NAME ? null : exportName,
    kind: null,
    status: "rendered",
    fiberCount: 0,
    unknownCount: 0,
    opaqueCount: 0,
    hookCount: 0,
    durationMs: 0,
    error: null,
  };
  try {
    const value = renderer.getExportValue(module.filePath, exportName);
    scan.kind = getComponentKind(value, exportName);
    if (scan.kind === null) return null;
    scan.name = getValueName(value) ?? scan.name;
    const result = renderer.renderExport(module.filePath, exportName, UNKNOWN_PROPS);
    const stats: TreeStats = { fibers: 0, unknowns: 0, opaque: 0 };
    collectTreeStats(result.root.root.children, stats, histograms);
    scan.fiberCount = stats.fibers;
    scan.unknownCount = stats.unknowns;
    scan.opaqueCount = stats.opaque;
    const [componentFiber] = result.root.root.children;
    scan.hookCount = componentFiber?.kind === "fiber" ? componentFiber.hooks.length : 0;
  } catch (error) {
    scan.status = error instanceof AnalysisTimeoutError ? "timed-out" : "crashed";
    scan.error = getErrorMessage(error);
  }
  scan.durationMs = Math.round(performance.now() - startedAt);
  return scan;
};

const renderEntry = (
  renderer: StaticRenderer,
  checkout: CorpusCheckout,
  entryFile: string,
): EntryTree | null => {
  const filePath = join(checkout.rootDirectory, entryFile);
  if (!renderer.project.getModule(filePath)) return null;
  const collect = (source: EntryTree["source"], result: StaticRenderResult): EntryTree => ({
    filePath: entryFile,
    source,
    fiberCount: result.root.fiberCount,
    unknownCount: result.root.unknownCount,
    tree: renderSnapshotTree(result.snapshot),
  });
  try {
    const [mount] = renderer.findMountPoints(filePath);
    if (mount) return collect("mount", renderer.renderValue(mount.element));
    const value = renderer.getExportValue(filePath);
    return getComponentKind(value, DEFAULT_EXPORT_NAME)
      ? collect("export", renderer.renderExport(filePath, DEFAULT_EXPORT_NAME, UNKNOWN_PROPS))
      : null;
  } catch (error) {
    return {
      filePath: entryFile,
      source: "export",
      fiberCount: 0,
      unknownCount: 0,
      tree: `crashed: ${getErrorMessage(error)}`,
    };
  }
};

/**
 * Parses every source module under the checkout's app directory, renders
 * each exported component with unknown props and aggregates what the
 * analysis could and could not explain. Exceptions are recorded rather than
 * thrown: a crash on real code is a finding.
 */
export const scanCheckout = (
  checkout: CorpusCheckout,
  options: ScanOptions = DEFAULT_SCAN_OPTIONS,
): RepositoryScan => {
  const startedAt = performance.now();
  const renderer = createStaticRenderer({
    rootDirectory: checkout.rootDirectory,
    followExternalModules: options.followExternalModules,
    build: { maxFiberCount: options.maxFiberCount },
    timeBudgetMs: options.timeBudgetMs,
  });
  const files = listSourceFiles(checkout.rootDirectory, checkout.appDirectory);
  const histograms: Histograms = {
    tags: createHistogram(),
    unknownReasons: createHistogram(),
    opaquePackages: createHistogram(),
  };
  const crashes = createHistogram();
  const unresolvedSpecifiers = createHistogram();
  const byEnvironment: Record<ModuleEnvironment, number> = { client: 0, server: 0, shared: 0 };
  const imports: ImportStats = {
    total: 0,
    internal: 0,
    external: 0,
    unresolved: 0,
    unresolvedSpecifiers: [],
  };
  const componentList: ComponentScan[] = [];
  let parsed = 0;
  let withErrors = 0;
  let found = 0;

  for (const [index, relativePath] of files.entries()) {
    if (options.maxComponents > 0 && componentList.length >= options.maxComponents) break;
    const module = renderer.project.getModule(join(checkout.rootDirectory, relativePath));
    if (!module) continue;
    parsed++;
    if (module.errors.length > 0) withErrors++;
    byEnvironment[module.environment]++;
    countImports(renderer, module, imports, unresolvedSpecifiers);
    if (index % 100 === 0) {
      options.onProgress?.(`${index}/${files.length} files, ${componentList.length} components`);
    }
    for (const exportName of module.exports.named.keys()) {
      const scan = scanExport(renderer, module, exportName, relativePath, histograms);
      if (!scan) continue;
      if (scan.kind !== null) found++;
      if (scan.status === "crashed" && scan.error) count(crashes, truncate(scan.error));
      componentList.push(scan);
    }
  }

  const entries = checkout.entryFiles
    .map((entryFile) => renderEntry(renderer, checkout, entryFile))
    .filter((entry): entry is EntryTree => entry !== null);

  const diagnostics = createHistogram();
  const diagnosticMessages = createHistogram();
  for (const diagnostic of renderer.interpreter.diagnostics) {
    count(diagnostics, diagnostic.code);
    count(diagnosticMessages, `${diagnostic.code}: ${truncate(diagnostic.message)}`);
  }
  imports.unresolvedSpecifiers = topReasons(unresolvedSpecifiers);

  const rendered = componentList.filter((scan) => scan.status === "rendered");
  const countStatus = (status: ComponentScanStatus): number =>
    componentList.filter((scan) => scan.status === status).length;
  return {
    name: checkout.name,
    commit: checkout.commit,
    framework: checkout.framework,
    reactVersion: checkout.reactVersion,
    appDirectory: checkout.appDirectory,
    files: { total: files.length, parsed, withErrors, byEnvironment },
    imports,
    components: {
      found,
      rendered: rendered.length,
      crashed: countStatus("crashed"),
      timedOut: countStatus("timed-out"),
      fullyKnown: rendered.filter((scan) => scan.unknownCount === 0 && scan.opaqueCount === 0)
        .length,
      fibers: rendered.reduce((total, scan) => total + scan.fiberCount, 0),
      unknowns: rendered.reduce((total, scan) => total + scan.unknownCount, 0),
      opaque: rendered.reduce((total, scan) => total + scan.opaqueCount, 0),
    },
    tags: toRecord(histograms.tags),
    diagnostics: toRecord(diagnostics),
    diagnosticMessages: topReasons(diagnosticMessages),
    unknownReasons: topReasons(histograms.unknownReasons),
    opaquePackages: topReasons(histograms.opaquePackages),
    crashes: topReasons(crashes),
    entries,
    componentList: componentList.sort((left, right) => right.fiberCount - left.fiberCount),
    durationMs: Math.round(performance.now() - startedAt),
  };
};
