import {
  andGuard,
  compareGuard,
  constantGuard,
  countGuardAtoms,
  decidesAlternatives,
  ELEMENT_SEGMENT,
  equalsGuard,
  inSetGuard,
  negateGuard,
  orGuard,
  parseSymbolicPredicate,
  predicateGuards,
  serializeSymbolicCardinality,
  serializeSymbolicPredicate,
  truthyGuard,
  type CompareOperator,
  type Guard,
  type GuardLiteral,
  type InputSourceKind,
  type InputVariable,
  type SymbolicVariable,
} from "../harness/symbolic-tree.js";
import { formatSourceLocation } from "../parse/source-location.js";
import type { SourceLocation, StaticBranchValue, StaticValue } from "../types.js";
import { UNDEFINED_VALUE, branchValue, describeValue, getTruthiness } from "./values.js";

// A branch predicate is the guard that picks an alternative, written over the
// inputs the interpreter could not see. Values derived from an input (its
// properties, its length, a comparison against a literal) resolve back to that
// input, so two branches deciding on the same unknown share its variable and
// the state space enumerates them together instead of multiplying them.

const subjectIds = new WeakMap<object, number>();
let nextSubjectId = 0;

const getSubjectId = (subject: object): number => {
  const existing = subjectIds.get(subject);
  if (existing !== undefined) return existing;
  const id = ++nextSubjectId;
  subjectIds.set(subject, id);
  return id;
};

const toInputId = (id: number): string => `#${id}`;

export interface PropertyDerivation {
  kind: "property";
  object: StaticValue;
  key: string;
}

export interface ElementDerivation {
  kind: "element";
  list: StaticValue;
}

export interface MeasureDerivation {
  kind: "length" | "typeof";
  operand: StaticValue;
}

export interface AliasDerivation {
  kind: "alias";
  operand: StaticValue;
}

/** The result of calling an opaque function with literal arguments; called again the same way it is the same result. */
export interface CallDerivation {
  kind: "call";
  callee: StaticValue;
  literals: GuardLiteral[];
}

export interface EqualityDerivation {
  kind: "equality";
  operand: StaticValue;
  literal: GuardLiteral | undefined;
  isStrict: boolean;
  isNegated: boolean;
}

export interface ComparisonDerivation {
  kind: "comparison";
  operand: StaticValue;
  operator: CompareOperator;
  literal: number;
}

export interface MembershipDerivation {
  kind: "membership";
  operand: StaticValue;
  literals: GuardLiteral[];
}

export interface LogicalDerivation {
  kind: "logical";
  operator: "&&" | "||";
  left: StaticValue;
  right: StaticValue;
}

export type Derivation =
  | PropertyDerivation
  | ElementDerivation
  | MeasureDerivation
  | AliasDerivation
  | CallDerivation
  | EqualityDerivation
  | ComparisonDerivation
  | MembershipDerivation
  | LogicalDerivation;

const derivations = new WeakMap<StaticValue, Derivation>();

/** Records how a freshly created uncertain `value` was computed from other values. */
export const recordDerivation = <T extends StaticValue>(value: T, derivation: Derivation): T => {
  derivations.set(value, derivation);
  return value;
};

const negations = new WeakMap<StaticValue, StaticValue>();

const isDerivedFrom = (value: StaticValue, candidate: StaticValue): boolean => {
  for (let current: StaticValue | undefined = value; current;) {
    if (current === candidate) return true;
    const derivation = derivations.get(current);
    current = derivation?.kind === "alias" ? derivation.operand : negations.get(current);
  }
  return false;
};

/** Records that `negated` is `!operand`, so tests of either take opposite sides. */
export const recordNegation = (negated: StaticValue, operand: StaticValue): StaticValue => {
  if (!isDerivedFrom(operand, negated)) negations.set(negated, operand);
  return negated;
};

/**
 * Records that `refined` is a branch rebuilt from `subject` by a test that
 * narrowed it (on one path, or rejoining both): it names the same runtime
 * value, so testing it again decides nothing new.
 */
export const recordRefinement = (refined: StaticValue, subject: StaticValue): void => {
  if (refined.kind === "branch" && !isDerivedFrom(subject, refined)) {
    recordDerivation(refined, { kind: "alias", operand: subject });
  }
};

interface InputSourceRecord {
  source: InputSourceKind;
  label: string | null;
  location: SourceLocation | null;
}

const inputSources = new WeakMap<StaticValue, InputSourceRecord>();

/** Records where an uncertain `value` enters the analysis from (a response, storage, the viewport…). */
export const recordInputSource = <T extends StaticValue>(
  value: T,
  source: InputSourceKind,
  location: SourceLocation | null = null,
  label: string | null = null,
): T => {
  inputSources.set(value, { source, label, location });
  return value;
};

interface ResolvedTerm {
  variable: SymbolicVariable;
  input: InputVariable;
}

const unalias = (value: StaticValue): StaticValue => {
  let current = value;
  for (
    let derivation = derivations.get(current);
    derivation?.kind === "alias";
    derivation = derivations.get(current)
  ) {
    current = derivation.operand;
  }
  return current;
};

const describeInput = (value: StaticValue): string =>
  value.kind === "unknown" || value.kind === "unknown-primitive"
    ? value.reason
    : describeValue(value);

const rootTerm = (value: StaticValue): ResolvedTerm => {
  const record = inputSources.get(value);
  const location = record?.location ?? (value.kind === "unknown" ? value.location : null);
  const input: InputVariable = {
    id: toInputId(getSubjectId(value)),
    label: record?.label ?? describeInput(value),
    source: record?.source ?? "unknown",
    location: location && formatSourceLocation(location),
  };
  return { variable: { input: input.id, path: [], measure: "value" }, input };
};

const projectTerm = (
  base: ResolvedTerm,
  extend: (variable: SymbolicVariable) => SymbolicVariable,
): ResolvedTerm | null =>
  base.variable.measure === "value" ? { ...base, variable: extend(base.variable) } : null;

const resolveTerm = (value: StaticValue): ResolvedTerm => {
  const subject = unalias(value);
  const derivation = derivations.get(subject);
  switch (derivation?.kind) {
    case "property":
      return (
        projectTerm(resolveTerm(derivation.object), (variable) => ({
          ...variable,
          path: [...variable.path, derivation.key],
        })) ?? rootTerm(subject)
      );
    case "element":
      return (
        projectTerm(resolveTerm(derivation.list), (variable) => ({
          ...variable,
          path: [...variable.path, ELEMENT_SEGMENT],
        })) ?? rootTerm(subject)
      );
    case "length":
    case "typeof":
      return (
        projectTerm(resolveTerm(derivation.operand), (variable) => ({
          ...variable,
          measure: derivation.kind,
        })) ?? rootTerm(subject)
      );
    case "call":
      return (
        projectTerm(resolveTerm(derivation.callee), (variable) => ({
          ...variable,
          path: [...variable.path, `(${derivation.literals.map(formatLiteral).join(",")})`],
        })) ?? rootTerm(subject)
      );
    default:
      return rootTerm(subject);
  }
};

const formatLiteral = (literal: GuardLiteral): string => JSON.stringify(literal);

/** The literal `arguments` of a call, or null when one is not a literal the result could be keyed on. */
export const toCallLiterals = (args: StaticValue[]): GuardLiteral[] | null => {
  const literals: GuardLiteral[] = [];
  for (const argument of args) {
    if (argument.kind !== "primitive") return null;
    const { value } = argument;
    if (typeof value === "undefined") literals.push(null);
    else if (typeof value === "bigint" || typeof value === "symbol") return null;
    else literals.push(value);
  }
  return literals;
};

interface ResolvedGuard {
  guard: Guard;
  inputs: InputVariable[];
}

const typeofTerm = (term: ResolvedTerm): SymbolicVariable => ({
  ...term.variable,
  measure: "typeof",
});

const isUndefinedGuard = (term: ResolvedTerm): Guard =>
  term.variable.measure === "value"
    ? equalsGuard(typeofTerm(term), "undefined")
    : equalsGuard(term.variable, null);

const equalityGuard = (term: ResolvedTerm, derivation: EqualityDerivation): Guard => {
  const { literal, isStrict } = derivation;
  const isNullish = literal === null || literal === undefined;
  if (isNullish && !isStrict && term.variable.measure === "value") {
    return orGuard([equalsGuard(term.variable, null), isUndefinedGuard(term)]);
  }
  if (literal === undefined) return isUndefinedGuard(term);
  return equalsGuard(term.variable, literal);
};

const resolveGuard = (test: StaticValue): ResolvedGuard => {
  let subject = unalias(test);
  let isNegated = false;
  for (let operand = negations.get(subject); operand; operand = negations.get(subject)) {
    subject = unalias(operand);
    isNegated = !isNegated;
  }
  const derivation = derivations.get(subject);
  let resolved: ResolvedGuard;
  switch (derivation?.kind) {
    case "equality": {
      const term = resolveTerm(derivation.operand);
      const guard = equalityGuard(term, derivation);
      resolved = { guard: derivation.isNegated ? negateGuard(guard) : guard, inputs: [term.input] };
      break;
    }
    case "comparison": {
      const term = resolveTerm(derivation.operand);
      resolved = {
        guard: compareGuard(term.variable, derivation.operator, derivation.literal),
        inputs: [term.input],
      };
      break;
    }
    case "membership": {
      const term = resolveTerm(derivation.operand);
      resolved = { guard: inSetGuard(term.variable, derivation.literals), inputs: [term.input] };
      break;
    }
    case "logical": {
      const left = resolveGuard(derivation.left);
      const right = resolveGuard(derivation.right);
      const operands = [left.guard, right.guard];
      resolved = {
        guard: derivation.operator === "&&" ? andGuard(operands) : orGuard(operands),
        inputs: mergeInputs([left.inputs, right.inputs]),
      };
      break;
    }
    default:
      resolved = resolveBranchGuard(subject) ?? resolveTruthyGuard(subject);
  }
  return isNegated ? { ...resolved, guard: negateGuard(resolved.guard) } : resolved;
};

const resolveTruthyGuard = (subject: StaticValue): ResolvedGuard => {
  const term = resolveTerm(subject);
  return { guard: truthyGuard(term.variable), inputs: [term.input] };
};

const branchOrigins = new WeakMap<StaticValue, StaticBranchValue>();

/** Records that `mapped` holds, alternative for alternative, a function of `source`, so both are decided by one choice. */
export const recordBranchOrigin = (mapped: StaticValue, source: StaticBranchValue): void => {
  if (mapped.kind !== "branch" || mapped.alternatives.length !== source.alternatives.length) return;
  branchOrigins.set(mapped, branchOrigins.get(source) ?? source);
};

/** The choice a predicate-less branch stands for: one input, named after the branch it was mapped from. */
const originChoicePredicate = (subject: StaticBranchValue): string => {
  const origin = branchOrigins.get(subject) ?? subject;
  if (origin.predicate !== null) return origin.predicate;
  const record = inputSources.get(origin);
  const location = record?.location ?? origin.location;
  return choicePredicate({
    id: toInputId(getSubjectId(origin)),
    label: record?.label ?? origin.reason,
    source: record?.source ?? "unknown",
    location: location && formatSourceLocation(location),
  });
};

/** The predicate a branch value is decided by: its own, or the choice it (or the branch it was mapped from) stands for. */
export const getBranchPredicate = (branch: StaticBranchValue): string =>
  branch.predicate ?? originChoicePredicate(branch);

export interface ResolvedAlternativeGuards {
  guards: Guard[];
  inputs: InputVariable[];
}

/** The guard each alternative of `branch` is taken under; null when its predicate does not decide that many. */
export const getAlternativeGuards = (
  branch: StaticBranchValue,
): ResolvedAlternativeGuards | null => {
  const predicate = parseSymbolicPredicate(getBranchPredicate(branch));
  if (!decidesAlternatives(predicate, branch.alternatives.length)) return null;
  return {
    guards: predicateGuards(predicate, branch.alternatives.length),
    inputs: predicate.inputs,
  };
};

/** Past this many atoms a composed predicate is dropped for an anonymous choice rather than handed to the solver. */
const MAX_PREDICATE_ATOMS = 64;

/** The predicate of a branch whose alternative `index` is taken under `guards[index]`; null when the guards outgrew the solver's budget. */
export const guardedPredicate = (guards: Guard[], inputs: InputVariable[][]): string | null =>
  guards.reduce((total, guard) => total + countGuardAtoms(guard), 0) > MAX_PREDICATE_ATOMS
    ? null
    : serializeSymbolicPredicate({
        formula: null,
        choice: null,
        guards,
        inputs: mergeInputs(inputs),
      });

/**
 * The predicate of a branch flattened out of `alternatives`, themselves
 * decided by `predicate` (or by a fork the analysis cannot see): the value at
 * `positions[index][innerIndex]` is taken when alternative `index` is and, if
 * that alternative is a branch, its alternative `innerIndex` is too.
 */
export const composeFlattenedPredicate = (
  predicate: string | null,
  reason: string,
  location: SourceLocation | null,
  alternatives: StaticValue[],
  positions: number[][],
  positionCount: number,
): string | null => {
  const outer = parseSymbolicPredicate(predicate ?? createPathPredicate(reason, location));
  if (!decidesAlternatives(outer, alternatives.length)) return null;
  const outerGuards = predicateGuards(outer, alternatives.length);
  const inputs = [outer.inputs];
  const sides: Guard[][] = Array.from({ length: positionCount }, () => []);
  for (const [index, alternative] of alternatives.entries()) {
    if (alternative.kind !== "branch") {
      sides[positions[index][0]].push(outerGuards[index]);
      continue;
    }
    const inner = getAlternativeGuards(alternative);
    if (!inner) return null;
    inputs.push(inner.inputs);
    for (const [innerIndex, guard] of inner.guards.entries()) {
      sides[positions[index][innerIndex]].push(andGuard([outerGuards[index], guard]));
    }
  }
  return guardedPredicate(sides.map(orGuard), inputs);
};

/** `a && b`, `a || b`, `c ? x : y` tested later: truthy under the alternatives' own guards, not a fresh variable. */
const resolveBranchGuard = (subject: StaticValue): ResolvedGuard | null => {
  if (subject.kind !== "branch") return null;
  const alternativeGuards = getAlternativeGuards(subject);
  if (!alternativeGuards) return null;
  const { guards } = alternativeGuards;
  const inputs = [alternativeGuards.inputs];
  const sides = subject.alternatives.map((alternative, index) => {
    const truthiness = getTruthiness(alternative);
    if (truthiness !== null) return andGuard([guards[index], constantGuard(truthiness)]);
    const resolved = resolveGuard(alternative);
    inputs.push(resolved.inputs);
    return andGuard([guards[index], resolved.guard]);
  });
  return { guard: orGuard(sides), inputs: mergeInputs(inputs) };
};

const mergeInputs = (groups: InputVariable[][]): InputVariable[] => {
  const byId = new Map<string, InputVariable>();
  for (const group of groups) for (const input of group) byId.set(input.id, input);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
};

/** The predicate of a two-way branch whose first alternative is taken when `test` is truthy (falsy when `isNegated`). */
export const getTruthinessPredicate = (test: StaticValue, isNegated = false): string => {
  const { guard, inputs } = resolveGuard(test);
  return serializeSymbolicPredicate({
    formula: isNegated ? negateGuard(guard) : guard,
    choice: null,
    guards: null,
    inputs: mergeInputs([inputs]),
  });
};

/** The predicate of a two-way branch whose first alternative is taken when `value` is not nullish (`??`). */
export const getPresencePredicate = (value: StaticValue): string => {
  const term = resolveTerm(value);
  return serializeSymbolicPredicate({
    formula: negateGuard(orGuard([equalsGuard(term.variable, null), isUndefinedGuard(term)])),
    choice: null,
    guards: null,
    inputs: [term.input],
  });
};

const choicePredicate = (input: InputVariable): string =>
  serializeSymbolicPredicate({
    formula: null,
    choice: { input: input.id, path: [], measure: "choice" },
    guards: null,
    inputs: [input],
  });

/** The predicate of a fork whose paths are decided by something the analysis cannot see. */
export const createPathPredicate = (reason: string, location: SourceLocation | null): string =>
  choicePredicate({
    id: toInputId(++nextSubjectId),
    label: reason,
    source: "path",
    location: location && formatSourceLocation(location),
  });

/**
 * An input that may be absent: `undefined` or `value`, decided by the same
 * variable later tests of `value` range over, so `x === undefined` and
 * `x === "beta"` stay two sides of one input.
 */
export const optionalInputValue = (
  value: StaticValue,
  reason: string,
  location: SourceLocation | null = null,
): StaticValue => {
  const term = resolveTerm(value);
  return branchValue(
    [UNDEFINED_VALUE, value],
    reason,
    location,
    0,
    serializeSymbolicPredicate({
      formula: isUndefinedGuard(term),
      choice: null,
      guards: null,
      inputs: [term.input],
    }),
  );
};

/** The predicate deciding which value a state cell holds in a committed tree. */
export const getStatePredicate = (cell: object, name: string): string =>
  choicePredicate({
    id: toInputId(getSubjectId(cell)),
    label: `state ${name}`,
    source: "state",
    location: null,
  });

const repeatSources = new WeakMap<StaticValue, StaticValue>();

/** Records that `repeat` iterates over `collection`, so its count is `len(collection)`. */
export const recordRepeatSource = <T extends StaticValue>(
  repeat: T,
  collection: StaticValue,
): T => {
  repeatSources.set(repeat, repeatSources.get(collection) ?? collection);
  return repeat;
};

/** The serialized cardinality of a repeat, or null when its collection is not an input the analysis can name. */
export const getRepeatCardinality = (repeat: StaticValue): string | null => {
  const collection = repeatSources.get(repeat);
  if (!collection) return null;
  const term = resolveTerm(collection);
  if (term.variable.measure !== "value") return null;
  return serializeSymbolicCardinality({
    variable: { ...term.variable, measure: "length" },
    inputs: [term.input],
  });
};
