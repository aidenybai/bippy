import { relative, resolve } from "node:path";
import { getStaticSsaBlockers } from "../../src/evaluate/ssa-execution.js";
import type {
  SsaFallback,
  SsaFunctionProfile,
  SsaProfile,
} from "../../src/evaluate/ssa-profile.js";
import { formatSourceLocation, getSourceLocation } from "../../src/parse/source-location.js";

export interface FixturePasses {
  name: string;
  setupMilliseconds: number;
  coldMilliseconds: number;
  warmMilliseconds: number[];
  warmProfiledMilliseconds: number[];
  heapUsedBytes: number;
  cold: SsaProfile;
  warm: SsaProfile[];
}

export interface FixtureRow {
  name: string;
  setupMilliseconds: number;
  coldMilliseconds: number;
  warmMilliseconds: number;
  warmProfiledMilliseconds: number;
  warmSpread: number;
  heapUsedBytes: number;
  invocations: number;
  ssaExecutions: number;
  uncertainExecutions: number;
  distinctFunctions: number;
  ssaOnlyFunctions: number;
  compilations: number;
  compileMilliseconds: number;
  fallbackSelfMilliseconds: number;
}

export interface ReasonRow {
  category: SsaFallback["category"];
  reason: string;
  invocations: number;
  functions: number;
  locations: number;
  fixtures: number;
  coldSelfMilliseconds: number;
  warmSelfMilliseconds: number;
}

export interface LocationRow {
  category: SsaFallback["category"];
  reason: string;
  location: string;
  invocations: number;
  fixtures: number;
  coldSelfMilliseconds: number;
}

export interface StaticBlockerRow {
  reason: string;
  functions: number;
  soleBlockerFunctions: number;
}

export interface FunctionRow {
  location: string;
  fixtures: number;
  invocations: number;
  ssaExecutions: number;
  reasons: string[];
  coldSelfMilliseconds: number;
  warmSelfMilliseconds: number;
}

export interface Distribution {
  median: number;
  p90: number;
  max: number;
  total: number;
}

export interface SsaFixtureReport {
  fixtures: FixtureRow[];
  totals: {
    fixtures: number;
    invocations: number;
    ssaExecutions: number;
    uncertainExecutions: number;
    fallbacksByCategory: Record<SsaFallback["category"], number>;
    distinctFunctions: number;
    ssaOnlyFunctions: number;
    fallbackOnlyFunctions: number;
    mixedFunctions: number;
    unblockedFallbackFunctions: number;
    setupMilliseconds: number;
    coldMilliseconds: number;
    warmMilliseconds: number;
    warmProfiledMilliseconds: number;
    warmRepeats: number;
    maxHeapUsedBytes: number;
  };
  warmSpread: Distribution;
  profilingOverhead: Distribution;
  compilation: {
    samples: number;
    milliseconds: Distribution;
    blocks: Distribution;
    instructions: Distribution;
    phis: Distribution;
  };
  reasons: ReasonRow[];
  locations: LocationRow[];
  staticBlockers: StaticBlockerRow[];
  functions: FunctionRow[];
}

interface FunctionAccumulator {
  row: FunctionRow;
  fixtures: Set<string>;
  reasons: Set<string>;
}

interface ReasonAccumulator {
  row: ReasonRow;
  functions: Set<string>;
  locations: Set<string>;
  fixtures: Set<string>;
}

interface LocationAccumulator {
  row: LocationRow;
  fixtures: Set<string>;
}

interface BlockerAccumulator {
  functions: number;
  soleBlockerFunctions: number;
}

const PACKAGE_DIRECTORY = resolve(import.meta.dirname, "../..");
const TOP_ROWS = 25;

const getRelativeLocation = (location: SsaFallback["location"]): string =>
  location
    ? formatSourceLocation({
        ...location,
        filePath: relative(PACKAGE_DIRECTORY, location.filePath),
      })
    : formatSourceLocation(null);

const getFunctionIdentity = (functionProfile: SsaFunctionProfile): string =>
  getRelativeLocation(getSourceLocation(functionProfile.file, functionProfile.node));

const getFallbackCount = (functionProfile: SsaFunctionProfile): number =>
  [...functionProfile.fallbacks.values()].reduce((total, { count }) => total + count, 0);

const getAttributedMilliseconds = (functionProfile: SsaFunctionProfile, count: number): number =>
  (functionProfile.fallbackSelfMilliseconds * count) / getFallbackCount(functionProfile);

const getDistribution = (samples: number[]): Distribution => {
  const sorted = [...samples].sort((left, right) => left - right);
  const getRank = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return {
    median: getRank(0.5),
    p90: getRank(0.9),
    max: sorted.at(-1) ?? 0,
    total: sorted.reduce((total, sample) => total + sample, 0),
  };
};

const sum = <Item>(items: Item[], getValue: (item: Item) => number): number =>
  items.reduce((total, item) => total + getValue(item), 0);

const getMedian = (samples: number[]): number => getDistribution(samples).median;

const getRelativeSpread = (samples: number[]): number => {
  const median = getMedian(samples);
  return median ? (Math.max(...samples) - Math.min(...samples)) / median : 0;
};

const getReasonKey = (fallback: SsaFallback): string => `${fallback.category}:${fallback.reason}`;

export const createSsaReportBuilder = () => {
  const fixtures: FixtureRow[] = [];
  const reasons = new Map<string, ReasonAccumulator>();
  const locations = new Map<string, LocationAccumulator>();
  const staticBlockers = new Map<string, BlockerAccumulator>();
  const functions = new Map<string, FunctionAccumulator>();
  const functionModes = new Map<string, { hasSsa: boolean; hasFallback: boolean }>();
  let warmRepeats = 0;
  const compilations: NonNullable<SsaFunctionProfile["compilation"]>[] = [];
  const blockerFunctions = new Set<string>();
  let unblockedFallbackFunctions = 0;
  const fallbacksByCategory: Record<SsaFallback["category"], number> = {
    static: 0,
    input: 0,
    deoptimization: 0,
  };

  const getReason = (fallback: SsaFallback): ReasonAccumulator => {
    const key = getReasonKey(fallback);
    const existing = reasons.get(key);
    if (existing) return existing;
    const created: ReasonAccumulator = {
      row: {
        category: fallback.category,
        reason: fallback.reason,
        invocations: 0,
        functions: 0,
        locations: 0,
        fixtures: 0,
        coldSelfMilliseconds: 0,
        warmSelfMilliseconds: 0,
      },
      functions: new Set(),
      locations: new Set(),
      fixtures: new Set(),
    };
    reasons.set(key, created);
    return created;
  };

  const getLocation = (fallback: SsaFallback): LocationAccumulator => {
    const key = `${getReasonKey(fallback)}@${getRelativeLocation(fallback.location)}`;
    const existing = locations.get(key);
    if (existing) return existing;
    const created: LocationAccumulator = {
      row: {
        category: fallback.category,
        reason: fallback.reason,
        location: getRelativeLocation(fallback.location),
        invocations: 0,
        fixtures: 0,
        coldSelfMilliseconds: 0,
      },
      fixtures: new Set(),
    };
    locations.set(key, created);
    return created;
  };

  const addStaticBlockers = (functionProfile: SsaFunctionProfile): void => {
    const blockerReasons = new Set(
      getStaticSsaBlockers(functionProfile.node).map(({ reason }) => reason),
    );
    if (blockerReasons.size === 0) unblockedFallbackFunctions++;
    for (const reason of blockerReasons) {
      const accumulator = staticBlockers.get(reason) ?? { functions: 0, soleBlockerFunctions: 0 };
      accumulator.functions++;
      if (blockerReasons.size === 1) accumulator.soleBlockerFunctions++;
      staticBlockers.set(reason, accumulator);
    }
  };

  const getFunction = (identity: string): FunctionAccumulator => {
    const existing = functions.get(identity);
    if (existing) return existing;
    const created: FunctionAccumulator = {
      row: {
        location: identity,
        fixtures: 0,
        invocations: 0,
        ssaExecutions: 0,
        reasons: [],
        coldSelfMilliseconds: 0,
        warmSelfMilliseconds: 0,
      },
      fixtures: new Set(),
      reasons: new Set(),
    };
    functions.set(identity, created);
    return created;
  };

  const addColdFunction = (name: string, functionProfile: SsaFunctionProfile): void => {
    const identity = getFunctionIdentity(functionProfile);
    const hotFunction = getFunction(identity);
    hotFunction.fixtures.add(name);
    hotFunction.row.invocations += functionProfile.invocations;
    hotFunction.row.ssaExecutions += functionProfile.executions;
    hotFunction.row.coldSelfMilliseconds += functionProfile.fallbackSelfMilliseconds;
    for (const { fallback } of functionProfile.fallbacks.values())
      hotFunction.reasons.add(getReasonKey(fallback));
    const mode = functionModes.get(identity) ?? { hasSsa: false, hasFallback: false };
    mode.hasSsa ||= functionProfile.executions > 0;
    mode.hasFallback ||= functionProfile.fallbacks.size > 0;
    functionModes.set(identity, mode);
    if (functionProfile.compilation) compilations.push(functionProfile.compilation);
    for (const { fallback, count } of functionProfile.fallbacks.values()) {
      fallbacksByCategory[fallback.category] += count;
      const attributed = getAttributedMilliseconds(functionProfile, count);
      const reason = getReason(fallback);
      reason.row.invocations += count;
      reason.row.coldSelfMilliseconds += attributed;
      reason.functions.add(identity);
      reason.locations.add(getRelativeLocation(fallback.location));
      reason.fixtures.add(name);
      const location = getLocation(fallback);
      location.row.invocations += count;
      location.row.coldSelfMilliseconds += attributed;
      location.fixtures.add(name);
    }
    if (functionProfile.fallbacks.size > 0 && !blockerFunctions.has(identity)) {
      blockerFunctions.add(identity);
      addStaticBlockers(functionProfile);
    }
  };

  const addWarmFunction = (functionProfile: SsaFunctionProfile, repeats: number): void => {
    getFunction(getFunctionIdentity(functionProfile)).row.warmSelfMilliseconds +=
      functionProfile.fallbackSelfMilliseconds / repeats;
    for (const { fallback, count } of functionProfile.fallbacks.values())
      getReason(fallback).row.warmSelfMilliseconds +=
        getAttributedMilliseconds(functionProfile, count) / repeats;
  };

  const addFixture = (passes: FixturePasses): void => {
    const coldFunctions = [...passes.cold.functions.values()];
    warmRepeats = passes.warm.length;
    for (const functionProfile of coldFunctions) addColdFunction(passes.name, functionProfile);
    for (const warm of passes.warm)
      for (const functionProfile of warm.functions.values())
        addWarmFunction(functionProfile, passes.warm.length);
    fixtures.push({
      name: passes.name,
      setupMilliseconds: passes.setupMilliseconds,
      coldMilliseconds: passes.coldMilliseconds,
      warmMilliseconds: getMedian(passes.warmMilliseconds),
      warmProfiledMilliseconds: getMedian(passes.warmProfiledMilliseconds),
      warmSpread: getRelativeSpread(passes.warmMilliseconds),
      heapUsedBytes: passes.heapUsedBytes,
      invocations: sum(coldFunctions, ({ invocations }) => invocations),
      ssaExecutions: sum(coldFunctions, ({ executions }) => executions),
      uncertainExecutions: sum(coldFunctions, ({ uncertainExecutions }) => uncertainExecutions),
      distinctFunctions: coldFunctions.length,
      ssaOnlyFunctions: coldFunctions.filter(
        ({ executions, invocations }) => executions > 0 && executions === invocations,
      ).length,
      compilations: coldFunctions.filter(({ compilation }) => compilation).length,
      compileMilliseconds: sum(coldFunctions, ({ compilation }) => compilation?.milliseconds ?? 0),
      fallbackSelfMilliseconds: sum(
        coldFunctions,
        (functionProfile) => functionProfile.fallbackSelfMilliseconds,
      ),
    });
  };

  const build = (): SsaFixtureReport => {
    const modes = [...functionModes.values()];
    return {
      fixtures,
      totals: {
        fixtures: fixtures.length,
        invocations: sum(fixtures, ({ invocations }) => invocations),
        ssaExecutions: sum(fixtures, ({ ssaExecutions }) => ssaExecutions),
        uncertainExecutions: sum(fixtures, ({ uncertainExecutions }) => uncertainExecutions),
        fallbacksByCategory,
        distinctFunctions: modes.length,
        ssaOnlyFunctions: modes.filter(({ hasSsa, hasFallback }) => hasSsa && !hasFallback).length,
        fallbackOnlyFunctions: modes.filter(({ hasSsa, hasFallback }) => !hasSsa && hasFallback)
          .length,
        mixedFunctions: modes.filter(({ hasSsa, hasFallback }) => hasSsa && hasFallback).length,
        unblockedFallbackFunctions,
        setupMilliseconds: sum(fixtures, ({ setupMilliseconds }) => setupMilliseconds),
        coldMilliseconds: sum(fixtures, ({ coldMilliseconds }) => coldMilliseconds),
        warmMilliseconds: sum(fixtures, ({ warmMilliseconds }) => warmMilliseconds),
        warmProfiledMilliseconds: sum(
          fixtures,
          ({ warmProfiledMilliseconds }) => warmProfiledMilliseconds,
        ),
        warmRepeats,
        maxHeapUsedBytes: Math.max(0, ...fixtures.map(({ heapUsedBytes }) => heapUsedBytes)),
      },
      warmSpread: getDistribution(fixtures.map(({ warmSpread }) => warmSpread)),
      profilingOverhead: getDistribution(
        fixtures
          .filter(({ warmMilliseconds }) => warmMilliseconds > 0)
          .map(
            ({ warmMilliseconds, warmProfiledMilliseconds }) =>
              warmProfiledMilliseconds / warmMilliseconds,
          ),
      ),
      compilation: {
        samples: compilations.length,
        milliseconds: getDistribution(compilations.map(({ milliseconds }) => milliseconds)),
        blocks: getDistribution(compilations.map(({ blocks }) => blocks)),
        instructions: getDistribution(compilations.map(({ instructions }) => instructions)),
        phis: getDistribution(compilations.map(({ phis }) => phis)),
      },
      reasons: [...reasons.values()]
        .map((accumulator) => ({
          ...accumulator.row,
          functions: accumulator.functions.size,
          locations: accumulator.locations.size,
          fixtures: accumulator.fixtures.size,
        }))
        .sort((left, right) => right.invocations - left.invocations),
      locations: [...locations.values()]
        .map((accumulator) => ({ ...accumulator.row, fixtures: accumulator.fixtures.size }))
        .sort((left, right) => right.invocations - left.invocations),
      staticBlockers: [...staticBlockers.entries()]
        .map(([reason, accumulator]) => ({ reason, ...accumulator }))
        .sort(
          (left, right) =>
            right.soleBlockerFunctions - left.soleBlockerFunctions ||
            right.functions - left.functions,
        ),
      functions: [...functions.values()]
        .filter(({ reasons: functionReasons }) => functionReasons.size > 0)
        .map((accumulator) => ({
          ...accumulator.row,
          fixtures: accumulator.fixtures.size,
          reasons: [...accumulator.reasons].sort(),
        }))
        .sort((left, right) => right.warmSelfMilliseconds - left.warmSelfMilliseconds),
    };
  };

  return { addFixture, build };
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 2 : 0);

const formatTable = (headers: string[], rows: (string | number)[][]): string =>
  [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${row.map((cell) => (typeof cell === "number" ? formatNumber(cell) : cell)).join(" | ")} |`,
    ),
  ].join("\n");

const formatPercent = (part: number, whole: number): string =>
  whole ? `${((part / whole) * 100).toFixed(1)}%` : "n/a";

const formatDistribution = (label: string, distribution: Distribution): (string | number)[] => [
  label,
  distribution.median,
  distribution.p90,
  distribution.max,
  distribution.total,
];

export const formatSsaReport = (report: SsaFixtureReport): string => {
  const { totals, compilation } = report;
  const fallbacks = sum(Object.values(totals.fallbacksByCategory), (count) => count);
  const byCost = [...report.reasons].sort(
    (left, right) => right.coldSelfMilliseconds - left.coldSelfMilliseconds,
  );
  const byFixtureCost = [...report.fixtures].sort(
    (left, right) => right.fallbackSelfMilliseconds - left.fallbackSelfMilliseconds,
  );
  const reasonRow = (row: ReasonRow) => [
    row.category,
    `\`${row.reason}\``,
    row.invocations,
    formatPercent(row.invocations, totals.invocations),
    row.functions,
    row.locations,
    row.fixtures,
    row.coldSelfMilliseconds,
    row.warmSelfMilliseconds,
  ];
  const reasonHeaders = [
    "category",
    "reason",
    "invocations",
    "share of invocations",
    "functions",
    "locations",
    "fixtures",
    "cold self ms",
    "warm self ms",
  ];
  return [
    "# SSA execution and fallback over component fixtures",
    "",
    "## Totals (first profiled render per fixture)",
    "",
    formatTable(
      ["measure", "value"],
      [
        ["fixtures", totals.fixtures],
        [
          "fixtures with a direct SSA execution",
          report.fixtures.filter(({ ssaExecutions }) => ssaExecutions > 0).length,
        ],
        [
          "largest fixture share of invocations",
          `${formatPercent(Math.max(0, ...report.fixtures.map(({ invocations }) => invocations)), totals.invocations)}`,
        ],
        ["function invocations", totals.invocations],
        [
          "direct SSA executions",
          `${totals.ssaExecutions} (${formatPercent(totals.ssaExecutions, totals.invocations)})`,
        ],
        ["SSA executions returning an uncertain value", totals.uncertainExecutions],
        ["static fallbacks", totals.fallbacksByCategory.static],
        [
          "input fallbacks (non-scalar parameters or outer bindings)",
          totals.fallbacksByCategory.input,
        ],
        ["runtime deoptimizations", totals.fallbacksByCategory.deoptimization],
        ["distinct functions", totals.distinctFunctions],
        ["functions that only executed SSA", totals.ssaOnlyFunctions],
        ["functions that only fell back", totals.fallbackOnlyFunctions],
        ["functions with both modes", totals.mixedFunctions],
        ["fell-back functions with no static blocker", totals.unblockedFallbackFunctions],
        ["renderer setup ms (graph, parse)", totals.setupMilliseconds],
        ["cold render ms (profiled)", totals.coldMilliseconds],
        ["warm render ms, sum of per-fixture medians (unprofiled)", totals.warmMilliseconds],
        ["warm render ms, sum of per-fixture medians (profiled)", totals.warmProfiledMilliseconds],
        ["max heapUsed after a cold render (MiB)", totals.maxHeapUsedBytes / 2 ** 20],
      ],
    ),
    "",
    `Fallback invocations: ${fallbacks} of ${totals.invocations}.`,
    "",
    `## Warm measurement (${totals.warmRepeats} interleaved unprofiled and profiled renders per fixture)`,
    "",
    formatTable(
      ["measure", "median", "p90", "max"],
      [
        [
          "spread of unprofiled renders ((max − min) / median)",
          report.warmSpread.median,
          report.warmSpread.p90,
          report.warmSpread.max,
        ],
        [
          "profiling overhead (profiled median / unprofiled median)",
          report.profilingOverhead.median,
          report.profilingOverhead.p90,
          report.profilingOverhead.max,
        ],
      ],
    ),
    "",
    "## Compilation (cache misses only)",
    "",
    formatTable(
      ["measure", "median", "p90", "max", "total"],
      [
        formatDistribution("compile ms", compilation.milliseconds),
        formatDistribution("blocks", compilation.blocks),
        formatDistribution("instructions", compilation.instructions),
        formatDistribution("phis", compilation.phis),
      ],
    ),
    "",
    `${compilation.samples} graphs compiled.`,
    "",
    "## Fallback reasons by frequency",
    "",
    formatTable(reasonHeaders, report.reasons.slice(0, TOP_ROWS).map(reasonRow)),
    "",
    "## Fallback reasons by measured AST self time",
    "",
    formatTable(reasonHeaders, byCost.slice(0, TOP_ROWS).map(reasonRow)),
    "",
    "## Static blockers per function",
    "",
    "Over every function that fell back at least once, `functions` counts those containing the operation in a reachable block; `sole blocker` counts those where it is the only static blocker. Supporting a sole blocker makes a function statically eligible; non-scalar inputs and outer bindings can still decline it at runtime.",
    "",
    formatTable(
      ["operation", "functions", "sole blocker"],
      report.staticBlockers
        .slice(0, TOP_ROWS)
        .map((row) => [`\`${row.reason}\``, row.functions, row.soleBlockerFunctions]),
    ),
    "",
    "## Hottest fallback locations",
    "",
    formatTable(
      ["category", "reason", "location", "invocations", "fixtures", "cold self ms"],
      report.locations
        .slice(0, TOP_ROWS)
        .map((row) => [
          row.category,
          `\`${row.reason}\``,
          `\`${row.location}\``,
          row.invocations,
          row.fixtures,
          row.coldSelfMilliseconds,
        ]),
    ),
    "",
    "## Hottest fell-back functions by warm AST self time",
    "",
    formatTable(
      [
        "function",
        "fixtures",
        "invocations",
        "SSA executions",
        "reasons",
        "cold self ms",
        "warm self ms",
      ],
      report.functions
        .slice(0, TOP_ROWS)
        .map((row) => [
          `\`${row.location}\``,
          row.fixtures,
          row.invocations,
          row.ssaExecutions,
          row.reasons.map((reason) => `\`${reason}\``).join(", "),
          row.coldSelfMilliseconds,
          row.warmSelfMilliseconds,
        ]),
    ),
    "",
    "## Fixtures with the most AST fallback self time",
    "",
    formatTable(
      [
        "fixture",
        "invocations",
        "SSA executions",
        "fallback self ms",
        "cold render ms",
        "warm render ms",
      ],
      byFixtureCost
        .slice(0, TOP_ROWS)
        .map((row) => [
          row.name,
          row.invocations,
          row.ssaExecutions,
          row.fallbackSelfMilliseconds,
          row.coldMilliseconds,
          row.warmMilliseconds,
        ]),
    ),
    "",
    "## Measurement boundaries",
    "",
    "- Each fixture gets a fresh renderer. Setup (module graph and parsing) is timed separately and is not profiled.",
    "- Pass 1 (cold, profiled) is the first render: SSA graphs compile on first use, keyed by AST node, so compile time appears here only.",
    `- Warm passes reuse the renderer and its compiled graphs. They alternate ${totals.warmRepeats} unprofiled and ${totals.warmRepeats} profiled renders, so drift affects both sides equally. Per-fixture warm times are medians; spread and overhead are distributions over fixtures.`,
    "- Counts, reasons, locations, and cold self ms come from pass 1; `warm self ms` is the mean over the profiled warm renders.",
    "- An SSA attempt is timed around compile lookup, blocker checks, and graph execution. A fallback's self time is its AST body evaluation minus nested profiled calls. It includes all AST work in that body, not only the blocked operation, and is split across a function's fallback reasons by invocation share.",
    "- heapUsed is sampled after pass 1 without forcing GC, so it shows trends only.",
    "- The report does not compare SSA against AST speed: the functions on each side differ, so no speedup follows from these numbers.",
  ].join("\n");
};
