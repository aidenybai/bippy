// Hard caps for the bounded path-feasibility checker. Exceeding any cap
// makes the checker return `unknown` rather than spend unbounded time — and
// `unknown` never prunes an interaction, so the caps only ever cost
// precision, never soundness.

// Max number of lowered facts (branch guards) in one path condition.
export const MAX_PATH_CLAUSES = 64;

// Max number of distinct abstract atoms (SSA values + constants) tracked.
export const MAX_PATH_VARS = 48;
