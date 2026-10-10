export const SOURCE_MAP_URL_RE = /\/\/[#@]\s*sourceMappingURL=(\S+)/;
export const SOURCE_FILE_RE = /\.(?:tsx?|jsx?|mjs|cjs)$/;

export const DEFAULT_REPORTS = ["v8", "console-details", "lcovonly"];
export const CLI_REPORTS = ["v8"];

export const DEFAULT_TOP_COUNT = 15;

export const FILE_COLUMN_MAX_WIDTH = 64;
export const UNCOVERED_COLUMN_WIDTH = 48;

export const COVERAGE_GOOD_PCT = 80;
export const COVERAGE_WARN_PCT = 50;

// Depth-weighted branch coverage weights each decision arm by
// `DEPTH_WEIGHT_BASE + guardDepth`, so taking a deeply-nested branch counts for
// more than a top-level one. With a base of 1 the score reduces to plain branch
// coverage when nothing is nested.
export const DEPTH_WEIGHT_BASE = 1;

// CFG terminal kinds that introduce a control-flow decision (a branch with
// >= 2 arms). A block's "guard depth" is how many of these it is
// control-dependent on; straight-line code and code *after* an `if` are 0.
export const BRANCH_TERMINAL_KINDS = new Set([
  "if",
  "switch",
  "while",
  "do-while",
  "for",
  "for-in",
  "for-of",
  "logical",
  "ternary",
  "optional",
]);

// Interaction (combinatorial) coverage measures, for two *independent* binary
// decisions that were each individually exercised both ways, whether all four
// outcome combinations co-occurred in some single test. Depth already captures
// nested (control-dependent) combinations, so only independent pairs add signal.
//
// Pairing is O(decisions^2) per function; skip functions above this many
// decisions to avoid pathological blowup (they still count toward depth).
export const MAX_DECISIONS_FOR_PAIRING = 60;

// Condition snippets shown in interaction targets are collapsed to one line and
// truncated to keep the report readable.
export const CONDITION_LABEL_MAX_CHARS = 56;

// Cap the uncovered-combination targets surfaced per report so the worklist
// stays actionable; they are ranked deepest-first.
export const MAX_INTERACTION_TARGETS = 25;

// A decision whose arm fires this many times inside a single test is running at
// a scale where branch coverage says nothing about performance (a fully-covered
// visibility check still melted at 100k-element drags). Such decisions are
// surfaced as stress-test candidates rather than coverage gaps.
export const HOT_DECISION_MIN_HITS_PER_TEST = 10_000;

export const MAX_HOT_DECISION_TARGETS = 10;

// Cap the half-covered branch worklist (reached decisions with an untaken arm),
// ranked deepest-first, so the most logic-gated gaps surface first.
export const MAX_BRANCH_GAPS = 30;

// Cap the synthesized edge-case worklist (boundary + nullish suggestions read
// off reached decisions' conditions), ranked deepest-first.
export const MAX_EDGE_CASES = 30;

// Cap the targeted mutation manifest (operator mutants a faithful test should
// kill, read off reached decisions), ranked deepest-first.
export const MAX_MUTATIONS = 30;
