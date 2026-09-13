import { z } from "zod";
import { collectGuardSides, type GuardSide } from "./guard-coverage.js";
import {
  evaluateGuard,
  solveGuards,
  toWitnessModel,
  type VariableWitness,
  type WitnessValue,
} from "./guard-solver.js";
import {
  andGuard,
  formatGuard,
  formatVariable,
  inputVariableSchema,
  symbolicVariableSchema,
  type InputVariable,
  type SymbolicTree,
  type SymbolicVariable,
} from "./symbolic-tree.js";

// A witness plan is the input to targeted runtime runs: each witness is one
// assignment of the symbolic inputs (a response body, a viewport, a storage
// value…) under which the guards it covers are decided the way listed. The
// harness does not execute it; a browser capturer that can install the
// assignments consumes it.

export interface InputAssignment {
  input: InputVariable;
  variable: SymbolicVariable;
  value: WitnessValue;
}

export interface PlannedWitness {
  assignments: InputAssignment[];
  /** The guard sides (`variable|side`) this assignment decides, with the guard each takes. */
  covers: CoveredSide[];
}

export interface CoveredSide {
  key: string;
  variable: string;
  side: number;
  guard: string;
}

export interface WitnessPlan {
  witnesses: PlannedWitness[];
  /** Sides no assignment reaches: they contradict the guards above them. */
  unreachable: CoveredSide[];
  /** Reachable sides the planner found no assignment deciding for certain. */
  uncovered: CoveredSide[];
}

const witnessValueSchema: z.ZodType<WitnessValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({
    typeof: z.enum([
      "undefined",
      "object",
      "boolean",
      "number",
      "bigint",
      "string",
      "symbol",
      "function",
    ]),
  }),
]);

const coveredSideSchema: z.ZodType<CoveredSide> = z.object({
  key: z.string(),
  variable: z.string(),
  side: z.number(),
  guard: z.string(),
});

export const witnessPlanSchema: z.ZodType<WitnessPlan> = z.object({
  witnesses: z.array(
    z.object({
      assignments: z.array(
        z.object({
          input: inputVariableSchema,
          variable: symbolicVariableSchema,
          value: witnessValueSchema,
        }),
      ),
      covers: z.array(coveredSideSchema),
    }),
  ),
  unreachable: z.array(coveredSideSchema),
  uncovered: z.array(coveredSideSchema),
});

const toCoveredSide = (side: GuardSide): CoveredSide => ({
  key: side.key,
  variable: side.variable,
  side: side.side,
  guard: formatGuard(side.guard),
});

const toAssignments = (
  witnesses: VariableWitness[],
  inputs: ReadonlyMap<string, InputVariable>,
): InputAssignment[] =>
  witnesses.map((witness) => ({
    input: inputs.get(witness.variable.input) ?? {
      id: witness.variable.input,
      label: witness.variable.input,
      source: "unknown",
      location: null,
    },
    variable: witness.variable,
    value: witness.value,
  }));

interface Candidate {
  witnesses: VariableWitness[];
  covers: Set<string>;
}

const sideCondition = (side: GuardSide) => andGuard([...side.pathGuards, side.guard]);

/** The sides an assignment decides for certain, given only the variables it pins. */
const coveredBy = (witnesses: VariableWitness[], sides: GuardSide[]): Set<string> => {
  const model = toWitnessModel(witnesses);
  return new Set(
    sides
      .filter((side) => evaluateGuard(sideCondition(side), model) === true)
      .map((side) => side.key),
  );
};

const candidateKey = (witnesses: VariableWitness[]): string =>
  witnesses
    .map((witness) => `${formatVariable(witness.variable)}=${JSON.stringify(witness.value)}`)
    .sort()
    .join(",");

/**
 * A set of input assignments that together take every reachable guard side,
 * chosen greedily: each step adds the assignment deciding the most sides not
 * yet covered. Greedy set cover is within a factor of `ln(k) + 1` of the fewest
 * assignments, `k` being the most sides one assignment covers; candidates are
 * one model per side, so a side is unreachable exactly when its guards
 * contradict the guards above it.
 */
export const planWitnesses = (tree: SymbolicTree): WitnessPlan => {
  const sides = collectGuardSides(tree);
  const inputs = new Map(tree.inputs.map((input) => [input.id, input]));
  const candidates = new Map<string, Candidate>();
  const unreachable: CoveredSide[] = [];
  for (const side of sides) {
    const witnesses = solveGuards([sideCondition(side)]);
    if (witnesses === null) {
      unreachable.push(toCoveredSide(side));
      continue;
    }
    const key = candidateKey(witnesses);
    if (!candidates.has(key)) {
      candidates.set(key, { witnesses, covers: coveredBy(witnesses, sides) });
    }
  }
  const uncovered = new Set(
    sides.map((side) => side.key).filter((key) => !unreachable.some((side) => side.key === key)),
  );
  const witnesses: PlannedWitness[] = [];
  while (uncovered.size > 0) {
    let best: Candidate | null = null;
    let bestGain = 0;
    for (const candidate of candidates.values()) {
      let gain = 0;
      for (const key of candidate.covers) if (uncovered.has(key)) gain++;
      if (gain > bestGain) {
        best = candidate;
        bestGain = gain;
      }
    }
    if (best === null) break;
    const covered = sides.filter((side) => best?.covers.has(side.key) && uncovered.has(side.key));
    for (const side of covered) uncovered.delete(side.key);
    witnesses.push({
      assignments: toAssignments(best.witnesses, inputs),
      covers: covered.map(toCoveredSide),
    });
  }
  return {
    witnesses,
    unreachable,
    uncovered: sides.filter((side) => uncovered.has(side.key)).map(toCoveredSide),
  };
};
