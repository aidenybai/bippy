import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eachMapping, originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { DEFAULT_REPORTS, SOURCE_FILE_RE, SOURCE_MAP_URL_RE } from "./constants.js";
import { isThirdPartyFile, prepareScript } from "./cfg-shared.js";
import type { OffsetMapper, PreparedScript, V8Function } from "./cfg-shared.js";
import { createLineIndex } from "./utils/line-index.js";
import type { V8CoverageEntry } from "./fixture.js";
import { accumulateScriptDepth, summarizeDepth } from "./depth.js";
import { buildModelFromPrepared, createInteractionAnalyzer } from "./interactions.js";
import type { ScriptInteractionModel } from "./interactions.js";
import { compressRanges } from "./utils/compress-ranges.js";
import { buildWorklist } from "./worklist.js";

interface ScriptCoverage {
  functions: unknown[];
}

// monocart's `Util.mergeV8Coverage` is the same bcoe/v8-coverage range-tree merge
// that `@bcoe/v8-coverage` ships, but it is part of the dependency we already
// pull in for reporting — so we reuse it instead of adding a second copy. It is
// real at runtime but missing from monocart's published `.d.ts`.
type MergeV8Coverage = (scriptCovs: ScriptCoverage[]) => { functions?: unknown[] };

interface UrlAccumulator {
  source: string;
  merged: ScriptCoverage;
  /** Remap map resolved once at merge (sibling / inline / identity). Always set. */
  mapJson: string;
}

// One observeTest unit for interaction coverage: a single test's raw (unmerged)
// V8 ranges for one served script. Collected during the merge pass so the
// interaction analysis never re-reads the dumps from disk.
interface TestObservation {
  localPath: string;
  functions: V8Function[];
}

interface MergedCoverage {
  accumulators: Map<string, UrlAccumulator>;
  observations: TestObservation[];
}

// monocart's generate() result carries these per-file fields but its published
// `.d.ts` types `files` loosely, so we narrow to just what we read.
interface MonocartMetric {
  covered?: number;
  total?: number;
}
interface MonocartFileResult {
  sourcePath?: string;
  url?: string;
  summary?: { branches?: MonocartMetric; functions?: MonocartMetric };
  data?: { lines?: Record<string, number | string> };
}

export interface CoverageMetric {
  pct: number;
  covered: number;
  total: number;
}

export interface FileCoverage {
  /** Remapped source path (or served URL when no map resolved). */
  file: string;
  /** Lines executed at least once (shallow: ran vs. didn't). */
  lines: CoverageMetric;
  /** Decision edges taken (one level deeper than lines). */
  branches: CoverageMetric;
  /** Functions entered. */
  functions: CoverageMetric;
  /** Uncovered line numbers as istanbul-style ranges, e.g. `"5-7,13"`. */
  uncoveredLines: string;
}

export interface CoverageSummary {
  lines: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  files: FileCoverage[];
  /** Control-flow depth, present only when `--depth` analysis ran. */
  depth?: DepthSummary;
  /**
   * Depth-weighted branch coverage: every decision arm contributes weight
   * `1 + guardDepth`, so exercising a deeply-nested branch scores higher than a
   * top-level one. Same arms as raw branch coverage, just reweighted — so
   * `weighted < branches` means the uncovered arms are the deep ones. Equals
   * plain branch coverage when nothing is nested. Present whenever depth ran.
   */
  weighted?: CoverageMetric;
  /**
   * Combinatorial (interaction) coverage of independent decision pairs. Depth
   * captures nested guards; this captures parallel guards that must be tested
   * *together*. Present whenever interaction analysis ran and found a pair.
   */
  interactions?: InteractionSummary;
  /**
   * The four worklists (half-covered branches, deepest gaps, interaction targets,
   * edge cases, mutants) merged into one priority-ranked queue of concrete tests
   * to write, deepest and highest-value first. This is the agent-facing view:
   * read the top item, write the test, re-run, repeat. Stable `id`s let a caller
   * diff two runs ("closed 3, opened 0"). Present whenever depth analysis ran.
   */
  worklist?: WorklistItem[];
}

// One concrete test to write, distilled from any of the analyses into a single
// actionable instruction. `kind` is the signal it came from; `priority` ranks
// the whole queue (depth dominates, signal type breaks ties); `id` is stable
// across runs so a caller can track what a new test closed or opened.
export interface WorklistItem {
  id: string;
  kind: "branch" | "deep-gap" | "interaction" | "edge" | "mutation";
  script: string;
  file?: string;
  line: number;
  depth: number;
  priority: number;
  /** The agent-actionable instruction, e.g. "drive `x > 0` to false". */
  action: string;
  /** Controlling condition text, when the item came from a decision. */
  condition?: string;
}

// The change in the worklist between two runs, keyed by stable `id`. `closed`
// items were in the baseline and are gone (a new test likely covered them);
// `opened` items are new (a regression, or newly-reached code surfacing fresh
// gaps); `carried` items are still open. This is the agent loop's progress view.
export interface WorklistDelta {
  closed: WorklistItem[];
  opened: WorklistItem[];
  carried: WorklistItem[];
}

// A mutant that survived a mutation-testing run: it was applied and the suite
// still passed, so nothing caught it. Parsed from a tool's report (Stryker's
// mutation-testing-elements schema is the documented source). Matching these
// back to the manifest turns a *predicted* gap into a *proven* one.
export interface MutationSurvivor {
  file: string;
  line: number;
  mutator?: string;
}

// A mutation-testing plan derived from the manifest: which lines to mutate and
// with which operators, scoped to the reached, depth-ranked decisions so a
// mutation tester (Stryker is the documented consumer) runs a tractable, targeted
// set instead of mutating the whole file. `targets` is the ranked manifest the
// run is expected to kill; a survivor among them is a real assertion gap.
export interface MutationPlan {
  /** `mutationRange` patterns (`file:line`) scoping mutation to our decisions. */
  mutate: string[];
  /** Mutator names these conditions imply (e.g. `EqualityOperator`, `LogicalOperator`). */
  mutators: string[];
  /** The operator mutants a faithful suite should kill, ranked deepest-first. */
  targets: Mutation[];
}

// Depth is measured per *served script* (the coordinate space V8 reports in),
// not per remapped source file — a bundled dist is one script covering many
// sources. The served-script path is mapped back to source only for display.
export interface ScriptDepth {
  /** Served script path (the bundle/module V8 measured). */
  script: string;
  /** CFG decision edges whose target block executed / total decision edges. */
  branchEdges: CoverageMetric;
  /** Deepest guard-nesting that exists in the script (0 = straight-line). */
  maxDepth: number;
  /** Deepest guard-nesting any test actually reached. */
  depthReached: number;
  /** Executed blocks at guard-depth >= 1 / all such blocks (how deep tests go). */
  deepBlocks: CoverageMetric;
  /**
   * Depth-weighted branch coverage for this script: `covered`/`total` are the
   * summed `1 + guardDepth` weights of taken vs. all decision arms.
   */
  weightedCoverage: CoverageMetric;
  /**
   * The deepest *unreached* block, for "add a spec that gets here". `file` is
   * the source-mapped path when a map resolved; `line` is the source line then,
   * otherwise the served-script line.
   */
  deepestGap?: { line: number; depth: number; file?: string };
  /** Reached decisions with an arm that never fired — see {@link BranchGap}. */
  branchGaps: BranchGap[];
  /** Structure-implied edge cases for reached decisions — see {@link EdgeCase}. */
  edgeCases: EdgeCase[];
  /** Targeted operator mutants for reached decisions — see {@link Mutation}. */
  mutations: Mutation[];
}

// A half-covered branch: a decision that executed but only ever took some of its
// arms. `arm` is the untaken outcome (`true`/`false`/`present`/`enter`/…) and
// `condition` is the controlling source text, so the fix is "make `condition`
// evaluate such that the `arm` branch is taken". Ranked by guard `depth`.
export interface BranchGap {
  script: string;
  file?: string;
  line: number;
  condition: string;
  arm: string;
  depth: number;
}

// An edge case a decision's *structure* implies a test should exercise. Unlike
// the branch/interaction worklists this is not a coverage measurement (V8 is
// blind to input values), but a synthesized suggestion read off the condition
// AST: a relational comparison's off-by-one `boundary`, or the `nullish` input
// that drives an optional chain / `??`. Only emitted for decisions that actually
// executed, ranked by guard `depth`, so the deepest (most edge-case-prone) come
// first. `hint` is the agent-actionable instruction; `condition` the source text.
export interface EdgeCase {
  script: string;
  file?: string;
  line: number;
  condition: string;
  kind: "boundary" | "nullish";
  hint: string;
  depth: number;
}

// One operator mutant a faithful test should kill, read off a reached decision's
// condition: a mutation tester that flips `original` to `mutated` at this
// location and re-runs the suite expects a failure. A survivor means the
// decision ran but the tests aren't sensitive to it. `bothArmsCovered` is true
// when the decision was exercised both ways, so the mutant is a real assertion
// test; false means covering the untaken arm is the prerequisite step. This is a
// targeted, coverage-filtered plan a tool like Stryker can consume instead of
// mutating the whole file blindly. Ranked by guard `depth`.
export interface Mutation {
  script: string;
  file?: string;
  line: number;
  depth: number;
  condition: string;
  kind: "relational" | "equality" | "logical";
  original: string;
  mutated: string;
  bothArmsCovered: boolean;
}

export interface DepthSummary {
  /** Branch-edge coverage aggregated across every analyzed script. */
  branchEdges: CoverageMetric;
  /** Max guard-nesting reached / max that exists, across all scripts. */
  maxDepth: number;
  depthReached: number;
  deepBlocks: CoverageMetric;
  /** Depth-weighted branch coverage aggregated across every analyzed script. */
  weightedCoverage: CoverageMetric;
  /** Ranked, deduped, capped worklist of reached-but-half-covered branches. */
  branchGaps: BranchGap[];
  /** Ranked, deduped, capped worklist of structure-implied edge cases to test. */
  edgeCases: EdgeCase[];
  /** Ranked, deduped, capped manifest of targeted operator mutants. */
  mutations: Mutation[];
  scripts: ScriptDepth[];
}

// A specific combinatorial gap: two independent decisions, each individually
// exercised both ways, whose given outcome-combination no single test reached.
// `a`/`b` carry the condition text + served-script line + the missing arm, so an
// agent can write "drive (a.arm) while (b.arm)".
export interface InteractionTarget {
  script: string;
  /** Max guard-depth of the two decisions, used to rank the worklist. */
  depth: number;
  a: { label: string; file?: string; line: number; arm: string };
  b: { label: string; file?: string; line: number; arm: string };
}

// A decision that fired at stress scale within a single test. Branch coverage
// treats one hit and a hundred thousand hits identically, but the latter marks
// a per-frame hot path whose cost profile only shows up under load — a
// stress-test candidate, not a coverage gap.
export interface HotDecisionTarget {
  script: string;
  label: string;
  file?: string;
  line: number;
  /** Peak hit count observed within a single test. */
  hits: number;
}

// Interaction (combinatorial) coverage: across *independent* binary decision
// pairs that were each exercised both ways, how many of their outcome
// combinations co-occurred in a single test. This is the signal depth misses —
// depth measures nested guards, this measures parallel ones interacting.
export interface InteractionSummary {
  /** Feasible outcome-combinations covered / total across independent pairs. */
  pairs: CoverageMetric;
  /** Uncovered feasible combinations, ranked deepest-first and capped. */
  targets: InteractionTarget[];
  /** Decisions firing at stress scale in one test, ranked hottest-first. */
  hotDecisions: HotDecisionTarget[];
}

export interface GenerateCoverageOptions {
  /**
   * Directory (or directories) holding per-test raw V8 dumps. Multiple dirs are
   * merged into one report — e.g. Playwright + Vitest captures for the same app.
   */
  rawDir: string | string[];
  /** Where monocart writes the generated reports. */
  outputDir: string;
  /** Base directory monocart resolves report paths against. Defaults to `process.cwd()`. */
  baseDir?: string;
  /** Report name shown in the html report. */
  name?: string;
  /** monocart report formats. Defaults to `["v8", "console-details", "lcovonly"]`. */
  reports?: string[];
  /**
   * Keep only entries whose served URL passes, applied before remapping. This is
   * the reliable knob for scoping a monorepo to one package: remapped source
   * paths are often bare basenames, but served URLs carry the full path.
   */
  urlFilter?: (servedUrl: string) => boolean;
  /**
   * Keep only the remapped source files you care about (receives an absolute
   * path). Defaults to dropping `node_modules` and non-source files.
   */
  sourceFilter?: (sourcePath: string) => boolean;
  /**
   * Measure control-flow *depth* — how deep into each script's CFG guard-nesting
   * the tests reached, via the vendored CFG engine (`./cfg`). On by default; pass
   * `false` to skip. Lazy: the CFG engine and parser load only when it runs.
   */
  depth?: boolean;
  /**
   * Measure *interaction* (combinatorial) coverage — whether independent binary
   * decisions were exercised in all their outcome-combinations together. On by
   * default; pass `false` to skip. Requires a second streaming pass over the raw
   * dumps (it needs per-test outcomes, which the merged coverage discards).
   */
  interactions?: boolean;
  /**
   * Prune interaction targets that are *provably infeasible* (two decisions over
   * the same value whose given arms contradict, so no single test could ever
   * exercise the combination). On by default; pass `false` to skip the SSA pass.
   * Sound either way: a combination is dropped only when proven impossible, so
   * disabling it only ever keeps extra (sound) targets.
   */
  pruneInfeasibleInteractions?: boolean;
  /** Verbose logging + dump the merged script URLs. Defaults to `Boolean(process.env.COVERAGE_DEBUG)`. */
  debug?: boolean;
}

const defaultSourceFilter = (sourcePath: string): boolean =>
  !sourcePath.includes("node_modules") && SOURCE_FILE_RE.test(sourcePath);

/** Turn a served script URL into a local filesystem path, if it maps to one. */
const urlToLocalPath = (url: string): string | null => {
  if (url.startsWith("file://")) {
    try {
      return fileURLToPath(url);
    } catch {
      return null;
    }
  }
  // Vite serves out-of-root files (e.g. a linked dist) as http://host/@fs/<abs>.
  try {
    const { pathname } = new URL(url);
    const fsMarker = "/@fs";
    const fsIndex = pathname.indexOf(`${fsMarker}/`);
    // Keep the marker's trailing slash so the result stays an absolute path
    // (`/@fs/Users/x` -> `/Users/x`), not a relative one.
    if (fsIndex !== -1) return decodeURIComponent(pathname.slice(fsIndex + fsMarker.length));
  } catch {
    // `url` is a bare filesystem path, not a parseable URL; fall through to the
    // absolute-path check below rather than dropping the entry.
  }
  if (isAbsolute(url) && existsSync(url)) return url;
  return null;
};

const inlineMapDataUri = (mapJson: string): string =>
  `data:application/json;base64,${Buffer.from(mapJson).toString("base64")}`;

const applyInlineMap = (source: string, inlined: string): string => {
  if (SOURCE_MAP_URL_RE.test(source)) {
    return source.replace(SOURCE_MAP_URL_RE, `//# sourceMappingURL=${inlined}`);
  }
  return `${source}\n//# sourceMappingURL=${inlined}`;
};

/**
 * Rewrite a source map's `sources` to absolute paths relative to the map file.
 * The remapper otherwise resolves dist's `../src/index.ts` against `baseDir`
 * and loses the package segment (yielding `packages/src/...`); absolute sources
 * remove that ambiguity so coverage lands on `packages/<name>/src/...`.
 */
const absolutizeMapSources = (mapJson: string, mapPath: string): string => {
  const map = JSON.parse(mapJson) as { sources?: string[]; sourceRoot?: string };
  const mapDir = dirname(mapPath);
  const sourceRoot = map.sourceRoot ?? "";
  map.sources = (map.sources ?? []).map((source) =>
    isAbsolute(source) ? source : resolve(mapDir, sourceRoot, source),
  );
  map.sourceRoot = "";
  return JSON.stringify(map);
};

/**
 * Decode an *inline* source map carried in a script's `//# sourceMappingURL=`
 * data URI, if present. A dev server (Vite, webpack-dev-server, …) serves each
 * module with its map inlined rather than as an on-disk `.map` sibling, so the
 * disk-based remap path can't see it; this lifts the map out of the source so
 * the same V8-range remap works against a live dev server. Returns the map JSON,
 * or `null` when the script has no map or only an external (file) reference.
 */
const decodeInlineSourceMap = (source: string): string | null => {
  const match = source.match(SOURCE_MAP_URL_RE);
  if (!match) return null;
  const dataUri = match[1]!.match(/^data:application\/json[^,]*?(;base64)?,(.*)$/s);
  if (!dataUri) return null;
  try {
    return dataUri[1]
      ? Buffer.from(dataUri[2]!, "base64").toString("utf8")
      : decodeURIComponent(dataUri[2]!);
  } catch {
    return null;
  }
};

/**
 * Derive a stable, unique source path from a served-script URL, for scripts
 * remapped from an inline map (no on-disk path to key on). A dev server inlines
 * a map whose `sources` is just the bare basename (`["app.tsx"]`), so keying on
 * it would collide every same-named module into one and lose the path in the
 * report. The served URL is the unique identity: `/@fs/<abs>` is the out-of-root
 * absolute path the server reported; otherwise the root-relative request path.
 */
const urlToSourcePath = (url: string): string => {
  // Prefer the same absolute path urlToLocalPath would use (/@fs, file://).
  const localPath = urlToLocalPath(url);
  if (localPath) return localPath;
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // bare path, not a URL: use as-is
  }
  pathname = pathname.split("?")[0]!;
  return decodeURIComponent(pathname.replace(/^\/+/, ""));
};

/**
 * Point an inline map's single source at `sourcePath` (the URL-derived identity)
 * instead of the dev server's bare basename, and drop any `sourceRoot`. Only the
 * single-source dev-module case is rewritten; a multi-source map (a real bundle
 * that happened to inline its map) is left untouched and absolutized as-is.
 * `sourcesContent` is preserved, so the remap never needs the file on disk —
 * essential when the report runs on a host that never had the served paths.
 */
const retargetInlineMapSource = (mapJson: string, sourcePath: string): string => {
  let map: { sources?: string[]; sourceRoot?: string };
  try {
    map = JSON.parse(mapJson);
  } catch {
    return mapJson;
  }
  if (Array.isArray(map.sources) && map.sources.length === 1) {
    map.sources = [sourcePath];
    map.sourceRoot = "";
  }
  return JSON.stringify(map);
};

const identityMapJson = (sourcePath: string, source: string): string => {
  const lineCount = Math.max(1, source.split("\n").length);
  const mappings = Array.from({ length: lineCount }, (_, index) =>
    index === 0 ? "AAAA" : "AACA",
  ).join(";");
  return JSON.stringify({
    version: 3,
    file: sourcePath,
    sources: [sourcePath],
    sourcesContent: [source],
    mappings,
  });
};

/**
 * Resolve script identity + remap map once. Sibling `.map` (built bundle), else
 * inline data-URI map (dev server), else identity map for an on-disk original.
 */
const resolveRemap = (
  entry: V8CoverageEntry,
): { key: string; mapJson: string; source: string } | null => {
  if (!entry.url || typeof entry.source !== "string") return null;
  const { source } = entry;
  const diskPath = urlToLocalPath(entry.url);
  if (diskPath && existsSync(`${diskPath}.map`)) {
    try {
      return {
        key: diskPath,
        mapJson: absolutizeMapSources(readFileSync(`${diskPath}.map`, "utf8"), `${diskPath}.map`),
        source,
      };
    } catch {
      return null;
    }
  }
  const decoded = decodeInlineSourceMap(source);
  if (decoded) {
    const key = urlToSourcePath(entry.url);
    return { key, mapJson: retargetInlineMapSource(decoded, key), source };
  }
  if (diskPath && existsSync(diskPath) && SOURCE_FILE_RE.test(diskPath)) {
    // Identity remap is only sound when the dump text is the on-disk original.
    // Transformed JS under a .ts URL (no inline map) would lie about offsets.
    try {
      if (readFileSync(diskPath, "utf8") !== source) return null;
    } catch {
      return null;
    }
    return { key: diskPath, mapJson: identityMapJson(diskPath, source), source };
  }
  return null;
};

/**
 * Read every per-test raw V8 file across one or more dump directories and collapse
 * them to one entry per script. Merge folds ranges immediately so memory stays
 * bounded by unique scripts, not dump count. Same key with a different source or
 * map is skipped (refuse to merge Playwright-transformed with Node-original).
 */
const mergeRawCoverage = (
  rawDirs: string[],
  mergeV8Coverage: MergeV8Coverage,
  urlFilter: ((servedUrl: string) => boolean) | undefined,
  collectObservations: boolean,
): MergedCoverage => {
  const accumulators = new Map<string, UrlAccumulator>();
  const observations: TestObservation[] = [];

  for (const rawDir of rawDirs) {
    let files: string[];
    try {
      files = readdirSync(rawDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      let entries: V8CoverageEntry[];
      try {
        entries = JSON.parse(readFileSync(join(rawDir, file), "utf8"));
      } catch {
        continue;
      }
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        if (urlFilter && !urlFilter(entry.url)) continue;
        const resolved = resolveRemap(entry);
        if (!resolved) continue;
        const { key, mapJson, source } = resolved;

        const functions = (entry.functions ?? []) as V8Function[];
        const scriptCov: ScriptCoverage = { functions };
        const accumulator = accumulators.get(key);
        if (accumulator) {
          if (accumulator.source !== source || accumulator.mapJson !== mapJson) continue;
          accumulator.merged = {
            functions: mergeV8Coverage([accumulator.merged, scriptCov]).functions ?? [],
          };
        } else {
          accumulators.set(key, { source, merged: scriptCov, mapJson });
        }
        if (collectObservations) observations.push({ localPath: key, functions });
      }
    }
  }

  return { accumulators, observations };
};

const toReportEntries = (accumulators: Map<string, UrlAccumulator>): V8CoverageEntry[] => {
  const entries: V8CoverageEntry[] = [];
  for (const [localPath, accumulator] of accumulators) {
    entries.push({
      url: localPath,
      source: applyInlineMap(accumulator.source, inlineMapDataUri(accumulator.mapJson)),
      scriptId: "0",
      functions: accumulator.merged.functions,
    });
  }
  return entries;
};

/**
 * The mapped generated columns on each generated line, sorted ascending. Built
 * once per source map by walking every mapping, so the offset mapper can find
 * the nearest mapped column to an unmapped byte without rescanning.
 */
const buildMappingIndex = (tracer: TraceMap): Map<number, number[]> => {
  const index = new Map<number, number[]>();
  eachMapping(tracer, (mapping) => {
    if (mapping.source === null || mapping.originalLine === null) return;
    const columns = index.get(mapping.generatedLine);
    if (columns) columns.push(mapping.generatedColumn);
    else index.set(mapping.generatedLine, [mapping.generatedColumn]);
  });
  for (const columns of index.values()) columns.sort((left, right) => left - right);
  return index;
};

/**
 * The mapped column closest to `target` in a sorted column list, or `null` when
 * the list is empty. Prefers the nearer of the columns straddling `target`. Used
 * to resolve a byte that falls between source-map entries to the nearest token.
 */
export const nearestMappedColumn = (columns: number[], target: number): number | null => {
  if (columns.length === 0) return null;
  let low = 0;
  let high = columns.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (columns[mid]! <= target) low = mid;
    else high = mid - 1;
  }
  const atOrBefore = columns[low]!;
  const after = columns[low + 1];
  if (atOrBefore > target) return atOrBefore; // target precedes the first column
  if (after !== undefined && after - target < target - atOrBefore) return after;
  return atOrBefore;
};

/**
 * Resolve served-script byte offsets back to original `file:line` through the
 * dist source map, so depth gaps and interaction targets read as real source
 * locations instead of bundle coordinates. Returns `null` when the map is
 * missing/unreadable; callers fall back to the served line.
 */
export const createOffsetMapper = (
  localPath: string,
  source: string,
  baseDir: string,
  mapJson: string,
): OffsetMapper | null => {
  let tracer: TraceMap;
  try {
    tracer = new TraceMap(mapJson);
  } catch {
    return null;
  }
  const lineIndex = createLineIndex(source);
  const mappingIndex = buildMappingIndex(tracer);
  const toFile = (mapped: string): string =>
    isAbsolute(mapped) ? relative(baseDir, mapped) : mapped;
  return (offset) => {
    const { line, column } = lineIndex.lineColOf(offset);
    // An exact mapping is the true source for that byte — trust it as-is.
    const exact = originalPositionFor(tracer, { line, column });
    if (exact.source && exact.line !== null)
      return { file: toFile(exact.source), line: exact.line };
    // A bundler emits a source-map entry per token, not per byte, so the exact
    // column often falls between mappings. Retry at the nearest mapped column on
    // the same generated line to recover the source line for deep expression
    // branches that would otherwise drop to bundle coordinates. This is a GUESS,
    // so reject a third-party hit: a first-party byte whose line carries only an
    // inlined dependency token would otherwise be relabeled `node_modules` and
    // then dropped by the third-party worklist filter, hiding a real first-party
    // gap. Returning null keeps it first-party via the served-line fallback.
    const columns = mappingIndex.get(line);
    const near = columns ? nearestMappedColumn(columns, column) : null;
    if (near !== null) {
      const guess = originalPositionFor(tracer, { line, column: near });
      if (guess.source && guess.line !== null) {
        const file = toFile(guess.source);
        if (!isThirdPartyFile(file)) return { file, line: guess.line };
      }
    }
    return null;
  };
};

const round2 = (value: number): number => Number(value.toFixed(2));

// A metric over zero items is vacuously fully covered (100%), matching the
// istanbul/nyc convention. Reporting 0% instead made branchless files — icons,
// constant tables, barrel re-exports — look like the least-covered code and
// sort to the top of the `--top` worklist, which is misleading.
export const toMetric = (covered: number, total: number): CoverageMetric => ({
  pct: total === 0 ? 100 : round2((100 * covered) / total),
  covered,
  total,
});

const fromMonocart = (metric: MonocartMetric | undefined): CoverageMetric =>
  toMetric(metric?.covered ?? 0, metric?.total ?? 0);

export const sumMetrics = (metrics: CoverageMetric[]): CoverageMetric =>
  toMetric(
    metrics.reduce((sum, metric) => sum + metric.covered, 0),
    metrics.reduce((sum, metric) => sum + metric.total, 0),
  );

/** monocart's `data.lines` value is a hit count or a "covered/total" string. */
const lineHitCount = (value: number | string): number =>
  typeof value === "number" ? value : Number(String(value).split("/")[0]);

const summarizeFile = (reportFile: MonocartFileResult, filePath: string): FileCoverage | null => {
  const lines = reportFile.data?.lines ?? {};
  let coveredLines = 0;
  let totalLines = 0;
  const uncoveredLineNumbers: number[] = [];
  for (const [lineNumber, value] of Object.entries(lines)) {
    totalLines++;
    if (lineHitCount(value) > 0) coveredLines++;
    else uncoveredLineNumbers.push(Number(lineNumber));
  }
  if (totalLines === 0) return null;
  return {
    file: filePath,
    lines: toMetric(coveredLines, totalLines),
    branches: fromMonocart(reportFile.summary?.branches),
    functions: fromMonocart(reportFile.summary?.functions),
    uncoveredLines: compressRanges(uncoveredLineNumbers),
  };
};

/**
 * Interaction (combinatorial) coverage needs *per-test* outcomes — which the
 * merged coverage discards — so the merge pass retains each test's raw ranges as
 * {@link TestObservation}s. The static decision model is built from the shared
 * per-script parse; each test's ranges then drive `observeTest`. Best-effort:
 * returns `null` rather than throwing if nothing qualifies.
 */
const analyzeInteractions = (
  observations: TestObservation[],
  accumulators: Map<string, UrlAccumulator>,
  prepared: Map<string, PreparedScript>,
  mapperFor: (localPath: string, source: string) => OffsetMapper | null,
  pruneInfeasible: boolean,
): InteractionSummary | null => {
  const models: ScriptInteractionModel[] = [];
  for (const [localPath, accumulator] of accumulators) {
    const preparedScript = prepared.get(localPath);
    if (!preparedScript) continue;
    const model = buildModelFromPrepared(
      preparedScript,
      localPath,
      accumulator.source,
      mapperFor(localPath, accumulator.source),
      pruneInfeasible,
    );
    if (model) models.push(model);
  }
  if (models.length === 0) return null;

  const analyzer = createInteractionAnalyzer(models);
  for (const observation of observations) {
    analyzer.observeTest(observation.localPath, observation.functions);
  }

  return analyzer.summarize();
};

/**
 * Merge the per-test raw V8 dumps, inline the dist source maps, and remap the
 * V8 byte ranges back onto `src/*` using monocart-coverage-reports as the remap
 * engine. monocart is loaded lazily so importing the fixture in test workers
 * never pulls in the heavy report dependency. Returns per-file line coverage
 * plus an overall total, or `null` when nothing remappable was captured.
 */
export const generateCoverageReport = async (
  options: GenerateCoverageOptions,
): Promise<CoverageSummary | null> => {
  const debug = options.debug ?? Boolean(process.env.COVERAGE_DEBUG);

  const { default: MCR } = await import("monocart-coverage-reports");
  const mergeV8Coverage = (MCR.Util as unknown as { mergeV8Coverage: MergeV8Coverage })
    .mergeV8Coverage;

  const wantDepth = options.depth !== false;
  const wantInteractions = options.interactions !== false;

  const rawDirs = (Array.isArray(options.rawDir) ? options.rawDir : [options.rawDir]).map(
    (rawDir) => resolve(rawDir),
  );
  const { accumulators, observations } = mergeRawCoverage(
    rawDirs,
    mergeV8Coverage,
    options.urlFilter,
    wantInteractions,
  );
  if (accumulators.size === 0) return null;

  if (debug) {
    const paths = [...accumulators.keys()].sort();
    console.log(
      `[coverage-debug] ${paths.length} merged scripts from ${rawDirs.length} raw dir(s):`,
    );
    for (const scriptPath of paths) console.log(`  ${scriptPath}`);
  }

  const baseDir = options.baseDir ?? process.cwd();
  const mcr = MCR({
    name: options.name ?? "coverage",
    outputDir: options.outputDir,
    baseDir,
    reports: options.reports ?? DEFAULT_REPORTS,
    cleanCache: true,
    logging: debug ? "debug" : "info",
    sourceFilter: options.sourceFilter ?? defaultSourceFilter,
  });

  await mcr.add(toReportEntries(accumulators));
  const results = await mcr.generate();
  const reportFiles = (results?.files ?? []) as MonocartFileResult[];

  const files: FileCoverage[] = [];
  for (const reportFile of reportFiles) {
    const filePath = reportFile.sourcePath ?? reportFile.url ?? "";
    // Drop entries that never source-mapped back (CSS, raw served URLs); they
    // keep their URL as the path and would otherwise pollute the per-file table.
    if (!SOURCE_FILE_RE.test(filePath)) continue;
    const summary = summarizeFile(reportFile, filePath);
    if (summary) files.push(summary);
  }

  const mapperCache = new Map<string, OffsetMapper | null>();
  const mapperFor = (localPath: string, source: string): OffsetMapper | null => {
    if (!mapperCache.has(localPath)) {
      const mapJson = accumulators.get(localPath)?.mapJson;
      mapperCache.set(
        localPath,
        mapJson ? createOffsetMapper(localPath, source, baseDir, mapJson) : null,
      );
    }
    return mapperCache.get(localPath) ?? null;
  };

  let depth: DepthSummary | undefined;
  let interactions: InteractionSummary | undefined;

  if (wantDepth || wantInteractions) {
    // Parse + build each script's CFG once, shared across both passes.
    const prepared = new Map<string, PreparedScript>();
    for (const [localPath, accumulator] of accumulators) {
      const script = prepareScript(localPath, accumulator.source);
      if (script) prepared.set(localPath, script);
    }

    if (wantDepth) {
      const scripts: ScriptDepth[] = [];
      for (const [localPath, accumulator] of accumulators) {
        const script = prepared.get(localPath);
        if (!script) continue;
        const scriptDepth = accumulateScriptDepth(
          script,
          localPath,
          accumulator.source,
          accumulator.merged.functions,
          mapperFor(localPath, accumulator.source),
        );
        if (scriptDepth) scripts.push(scriptDepth);
      }
      if (scripts.length > 0) depth = summarizeDepth(scripts);
    }

    if (wantInteractions) {
      interactions =
        analyzeInteractions(
          observations,
          accumulators,
          prepared,
          mapperFor,
          options.pruneInfeasibleInteractions !== false,
        ) ?? undefined;
    }
  }

  const summary: CoverageSummary = {
    lines: sumMetrics(files.map((file) => file.lines)),
    branches: sumMetrics(files.map((file) => file.branches)),
    functions: sumMetrics(files.map((file) => file.functions)),
    files,
    depth,
    weighted: depth?.weightedCoverage,
    interactions,
  };
  // The unified worklist is derived from the assembled summary, so build it last.
  if (depth) summary.worklist = buildWorklist(summary);
  return summary;
};
