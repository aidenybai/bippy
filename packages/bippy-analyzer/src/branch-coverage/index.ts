export { capturePlaywrightCoverage, cleanRawCoverage } from "./fixture.js";
export type { CoveragePage, V8CoverageEntry } from "./fixture.js";
export { captureNodeCoverage } from "./node-fixture.js";
export { generateCoverageReport } from "./report.js";
export type {
  CoverageMetric,
  CoverageSummary,
  FileCoverage,
  GenerateCoverageOptions,
  ScriptDepth,
  WorklistItem,
} from "./report.js";
export { formatCoverageTable } from "./format.js";
export type { FormatTableOptions } from "./format.js";
export { analyzeScriptDepth } from "./depth.js";
export { MUTATION_GATE, instrumentForMutation } from "./mutation-runtime.js";
export type { InstrumentedScript, RuntimeMutant } from "./mutation-runtime.js";
