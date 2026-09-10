import {
  andGuard,
  compareGuard,
  constantGuard,
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

/** Records that `negated` is `!operand`, so tests of either take opposite sides. */
export const recordNegation = (negated: StaticValue, operand: StaticValue): StaticValue => {
  negations.set(negated, operand);
  return negated;
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
    default:
      return rootTerm(subject);
  }
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
  const record = inputSources.get(origin);
  const location = record?.location ?? origin.location;
  return choicePredicate({
    id: toInputId(getSubjectId(origin)),
    label: record?.label ?? origin.reason,
    source: record?.source ?? "unknown",
    location: location && formatSourceLocation(location),
  });
};

/** `a && b`, `a || b`, `c ? x : y` tested later: truthy under the alternatives' own guards, not a fresh variable. */
const resolveBranchGuard = (subject: StaticValue): ResolvedGuard | null => {
  if (subject.kind !== "branch") return null;
  const predicate = parseSymbolicPredicate(subject.predicate ?? originChoicePredicate(subject));
  const guards = predicateGuards(predicate, subject.alternatives.length);
  const inputs = [predicate.inputs];
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
    inputs: mergeInputs([inputs]),
  });
};

/** The predicate of a two-way branch whose first alternative is taken when `value` is not nullish (`??`). */
export const getPresencePredicate = (value: StaticValue): string => {
  const term = resolveTerm(value);
  return serializeSymbolicPredicate({
    formula: negateGuard(orGuard([equalsGuard(term.variable, null), isUndefinedGuard(term)])),
    choice: null,
    inputs: [term.input],
  });
};

const choicePredicate = (input: InputVariable): string =>
  serializeSymbolicPredicate({
    formula: null,
    choice: { input: input.id, path: [], measure: "choice" },
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

/** The predicate deciding where Flight's row overflowed while serializing `children` to the client. */
export const getFlightDeferralPredicate = (children: StaticValue): string =>
  choicePredicate({
    id: toInputId(getSubjectId(children)),
    label: "Flight row overflow",
    source: "flight",
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
