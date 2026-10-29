import { describe, expect, it } from "vite-plus/test";
import { assumeCondition, evaluateCondition } from "../../src/core/solver/constraints";
import type { Constraints } from "../../src/core/solver/constraints";
import { formatSymbolicValue } from "../../src/core/values/format";
import { createBindingValue, foldBinary, foldUnary } from "../../src/core/values/symbolic-values";
import type {
  AbstractValue,
  BinaryOperator,
  Binding,
  PrimitiveValue,
  SymbolicValue,
  TestKind,
} from "../../src/core/types";
import { getBindingPlace } from "../../src/core/values/get-binding-place";
import { PlaceMap } from "../../src/core/values/place-map";
import { GeneratedSource, makeInstructionId } from "../../src/react-compiler/HIR/HIR";
import { createTestBinding } from "./helpers";

type Concrete = PrimitiveValue | never[] | Record<string, never>;

interface Case {
  label: string;
  abstract: AbstractValue;
  concrete: Concrete;
}

interface Model {
  bindings: Binding[];
  cases: Case[][];
}

const SEED = 20261021;
const RUNS = 4000;
const MAX_DEPTH = 3;
const LENGTH_FIELD = "length";

const createLiteralCase = (value: PrimitiveValue, label = String(value)): Case => ({
  label: typeof value === "string" ? JSON.stringify(value) : label,
  abstract: { kind: "Literal", value },
  concrete: value,
});

const CASES: Case[] = [
  createLiteralCase(0),
  createLiteralCase(-0, "-0"),
  createLiteralCase(1),
  createLiteralCase(Number.NaN),
  createLiteralCase(Number.POSITIVE_INFINITY),
  createLiteralCase(""),
  createLiteralCase("0"),
  createLiteralCase("a"),
  createLiteralCase(true),
  createLiteralCase(false),
  createLiteralCase(null),
  createLiteralCase(undefined),
  { label: "[]", abstract: { kind: "Type", text: "never[]", primitive: null }, concrete: [] },
  { label: "{}", abstract: { kind: "Type", text: "object", primitive: null }, concrete: {} },
];

const LITERALS: PrimitiveValue[] = [0, 1, -1, 2, "", "0", "a", true, false, null, undefined];

const COMPARISON_OPERATORS: BinaryOperator[] = ["===", "!==", "==", "!=", "<", "<=", ">", ">="];

const TYPEOF_NAMES = ["number", "string", "boolean", "undefined", "object"];

const createRandom = (seed: number) => {
  let state = seed;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <Item>(items: Item[]): Item => {
    if (items.length === 0) throw new Error("Cannot pick from an empty list");
    return items[Math.floor(next() * items.length)] as Item;
  };
  return { next, pick, chance: (probability: number) => next() < probability };
};

type Random = ReturnType<typeof createRandom>;

let nextBranchId = 0;

const createConditional = (
  test: SymbolicValue,
  testKind: TestKind,
  consequent: SymbolicValue,
  alternate: SymbolicValue,
): SymbolicValue => ({
  kind: "Conditional",
  test,
  testKind,
  consequent,
  alternate,
  branch: {
    terminalId: makeInstructionId(nextBranchId++),
    probe: testKind,
    loc: GeneratedSource,
    file: "solver-properties",
  },
  guardKeys: [],
});

const createModel = (random: Random): Model => {
  const bindingCount = 1 + Math.floor(random.next() * 3);
  const bindings = Array.from({ length: bindingCount }, (_unused, index) =>
    createTestBinding({ id: index, name: ["x", "y", "z"][index] }),
  );
  const cases = bindings.map(() => {
    const caseCount = 1 + Math.floor(random.next() * 4);
    return [...new Set(Array.from({ length: caseCount }, () => random.pick(CASES)))];
  });
  return { bindings, cases };
};

const isStringBinding = (model: Model, index: number): boolean =>
  model.cases[index]?.every((candidate) => typeof candidate.concrete === "string") ?? false;

const generateTerm = (model: Model, random: Random): SymbolicValue => {
  const index = Math.floor(random.next() * model.bindings.length);
  const binding = model.bindings[index];
  if (!binding || random.chance(0.15)) return { kind: "Primitive", value: random.pick(LITERALS) };
  if (isStringBinding(model, index) && random.chance(0.3))
    return createBindingValue(binding, [LENGTH_FIELD]);
  const value = createBindingValue(binding);
  return random.chance(0.15)
    ? foldBinary(random.pick(["+", "-"]), value, { kind: "Primitive", value: random.pick([1, 2]) })
    : value;
};

const generateFormula = (model: Model, random: Random, depth: number): SymbolicValue => {
  const roll = random.next();
  if (depth >= MAX_DEPTH || roll < 0.35)
    return foldBinary(
      random.pick(COMPARISON_OPERATORS),
      generateTerm(model, random),
      generateTerm(model, random),
    );
  if (roll < 0.42) return generateTerm(model, random);
  if (roll < 0.47)
    return foldBinary(
      random.pick(["===", "!=="]),
      foldUnary("typeof", generateTerm(model, random)),
      { kind: "Primitive", value: random.pick(TYPEOF_NAMES) },
    );
  if (roll < 0.6) return foldUnary("!", generateFormula(model, random, depth + 1));
  const left = generateFormula(model, random, depth + 1);
  const right = generateFormula(model, random, depth + 1);
  if (roll < 0.75) return createConditional(left, "truthy", right, left);
  if (roll < 0.9) return createConditional(left, "truthy", left, right);
  return createConditional(left, "nullish", left, right);
};

const toPrimitive = (value: Concrete): PrimitiveValue =>
  typeof value === "object" && value !== null ? String(value) : value;

const compareRelational = (operator: BinaryOperator, left: Concrete, right: Concrete): boolean => {
  const leftPrimitive = toPrimitive(left);
  const rightPrimitive = toPrimitive(right);
  if (typeof leftPrimitive === "string" && typeof rightPrimitive === "string") {
    if (operator === "<") return leftPrimitive < rightPrimitive;
    if (operator === "<=") return leftPrimitive <= rightPrimitive;
    if (operator === ">") return leftPrimitive > rightPrimitive;
    return leftPrimitive >= rightPrimitive;
  }
  const leftNumber = Number(leftPrimitive);
  const rightNumber = Number(rightPrimitive);
  if (operator === "<") return leftNumber < rightNumber;
  if (operator === "<=") return leftNumber <= rightNumber;
  if (operator === ">") return leftNumber > rightNumber;
  return leftNumber >= rightNumber;
};

const applyBinary = (operator: BinaryOperator, left: Concrete, right: Concrete): Concrete => {
  switch (operator) {
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
      // oxlint-disable-next-line eqeqeq -- Evaluates JavaScript loose equality as written.
      return left == right;
    case "!=":
      // oxlint-disable-next-line eqeqeq -- Evaluates JavaScript loose equality as written.
      return left != right;
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compareRelational(operator, left, right);
    case "+": {
      const leftPrimitive = toPrimitive(left);
      const rightPrimitive = toPrimitive(right);
      return typeof leftPrimitive === "string" || typeof rightPrimitive === "string"
        ? String(leftPrimitive) + String(rightPrimitive)
        : Number(leftPrimitive) + Number(rightPrimitive);
    }
    case "-":
      return Number(toPrimitive(left)) - Number(toPrimitive(right));
    default:
      throw new Error(`Unsupported operator ${operator}`);
  }
};

const evaluateConcrete = (value: SymbolicValue, assignment: Concrete[]): Concrete => {
  switch (value.kind) {
    case "Primitive":
      return value.value;
    case "Binding": {
      const bound = assignment[value.binding.id];
      if (value.path.length === 0) return bound;
      return typeof bound === "string" ? bound.length : undefined;
    }
    case "UnaryExpression": {
      const operand = evaluateConcrete(value.value, assignment);
      if (value.operator === "!") return !operand;
      if (value.operator === "typeof") return typeof operand;
      throw new Error(`Unsupported operator ${value.operator}`);
    }
    case "BinaryExpression":
      return applyBinary(
        value.operator,
        evaluateConcrete(value.left, assignment),
        evaluateConcrete(value.right, assignment),
      );
    case "Conditional": {
      const test = evaluateConcrete(value.test, assignment);
      const isTaken =
        value.testKind === "truthy" ? Boolean(test) : test !== null && test !== undefined;
      return evaluateConcrete(isTaken ? value.consequent : value.alternate, assignment);
    }
    default:
      throw new Error(`Unsupported value ${value.kind}`);
  }
};

const getAssignments = (model: Model): Case[][] =>
  model.cases.reduce<Case[][]>(
    (assignments, bindingCases) =>
      assignments.flatMap((assignment) => bindingCases.map((option) => [...assignment, option])),
    [[]],
  );

const createConstraints = (model: Model): Constraints => {
  const possibleValues = new PlaceMap<AbstractValue[]>();
  model.bindings.forEach((binding, index) => {
    possibleValues.set(
      getBindingPlace(binding),
      (model.cases[index] ?? []).map((option) => option.abstract),
    );
    if (isStringBinding(model, index))
      possibleValues.set(getBindingPlace(binding, [LENGTH_FIELD]), [
        { kind: "Type", text: "number", primitive: "number" },
      ]);
  });
  return {
    possibleValues,
    assumptions: new Map(),
    bounds: [],
    boundGraph: null,
    invariants: [],
    finitePlaces: new PlaceMap(),
    unionMemberValues: new PlaceMap(),
    placeDomains: new PlaceMap(),
    possibleMembers: new Map(),
  };
};

const isSameValueZero = (left: Concrete, right: Concrete): boolean =>
  left === right || (Number.isNaN(left) && Number.isNaN(right));

const admits = (abstract: AbstractValue, concrete: Concrete): boolean => {
  if (abstract.kind === "Literal") return isSameValueZero(abstract.value, concrete);
  if (abstract.kind === "Collection") return false;
  if (abstract.primitive === null) return typeof concrete === "object" && concrete !== null;
  return typeof concrete === abstract.primitive;
};

const FOLLOW_UPS = 3;

const findFailure = (formulas: SymbolicValue[], model: Model): string | null => {
  const [formula, ...followUps] = formulas;
  if (!formula) return null;
  const assignments = getAssignments(model);
  const truthsOf = (value: SymbolicValue): boolean[] =>
    assignments.map((assignment) =>
      Boolean(
        evaluateConcrete(
          value,
          assignment.map((option) => option.concrete),
        ),
      ),
    );
  const truths = truthsOf(formula);
  const decided = evaluateCondition(formula, createConstraints(model));
  if (decided === true && truths.includes(false)) return "decided true, but can be false";
  if (decided === false && truths.includes(true)) return "decided false, but can be true";
  for (const isTrue of [true, false]) {
    const satisfying = assignments.filter((_assignment, index) => truths[index] === isTrue);
    if (satisfying.length === 0) continue;
    const assumed = assumeCondition(formula, isTrue, createConstraints(model));
    if (!assumed) return `assuming it ${isTrue} was ruled out, but it can be ${isTrue}`;
    if (evaluateCondition(formula, assumed) === !isTrue)
      return `after assuming it ${isTrue}, it is decided ${!isTrue}`;
    for (const assignment of satisfying)
      for (const [index, binding] of model.bindings.entries()) {
        const kept = assumed.possibleValues.get(getBindingPlace(binding));
        const option = assignment[index];
        if (kept && option && !kept.some((value) => admits(value, option.concrete)))
          return `assuming it ${isTrue} dropped ${binding.name} = ${option.label}`;
      }
    for (const [followUpIndex, followUp] of followUps.entries()) {
      const followUpTruths = truthsOf(followUp).filter((_truth, index) => truths[index] === isTrue);
      const followUpDecided = evaluateCondition(followUp, assumed);
      if (followUpDecided !== null && followUpTruths.includes(!followUpDecided))
        return `after assuming it ${isTrue}, follow-up ${followUpIndex + 1} is decided ${followUpDecided}, but can be ${!followUpDecided}`;
      for (const isFollowUpTrue of [true, false])
        if (
          followUpTruths.includes(isFollowUpTrue) &&
          !assumeCondition(followUp, isFollowUpTrue, assumed)
        )
          return `after assuming it ${isTrue}, assuming follow-up ${followUpIndex + 1} ${isFollowUpTrue} was ruled out`;
    }
  }
  return null;
};

const getChildren = (value: SymbolicValue): SymbolicValue[] => {
  switch (value.kind) {
    case "UnaryExpression":
      return [value.value];
    case "BinaryExpression":
      return [value.left, value.right];
    case "Conditional":
      return [value.test, value.consequent, value.alternate];
    default:
      return [];
  }
};

const shrink = (formulas: SymbolicValue[], model: Model): [SymbolicValue[], Model] => {
  for (const [index, formula] of formulas.entries()) {
    const candidates = [
      ...(index > 0 ? [formulas.filter((_formula, formulaIndex) => formulaIndex !== index)] : []),
      ...getChildren(formula).map((child) =>
        formulas.map((other, otherIndex) => (otherIndex === index ? child : other)),
      ),
    ];
    const smaller = candidates.find((candidate) => findFailure(candidate, model) !== null);
    if (smaller) return shrink(smaller, model);
  }
  for (const [index, bindingCases] of model.cases.entries()) {
    if (bindingCases.length < 2) continue;
    for (const option of bindingCases) {
      const smallerModel: Model = {
        bindings: model.bindings,
        cases: model.cases.map((candidates, candidateIndex) =>
          candidateIndex === index
            ? candidates.filter((candidate) => candidate !== option)
            : candidates,
        ),
      };
      if (findFailure(formulas, smallerModel) !== null) return shrink(formulas, smallerModel);
    }
  }
  return [formulas, model];
};

const describeFailure = (formulas: SymbolicValue[], model: Model): string => {
  const domain = model.bindings
    .map(
      (binding, index) =>
        `${binding.name} ∈ {${(model.cases[index] ?? []).map((option) => option.label).join(", ")}}`,
    )
    .join(", ");
  const [formula, ...followUps] = formulas.map(formatSymbolicValue);
  const followUpText = followUps
    .map((followUp, index) => `, follow-up ${index + 1}: ${followUp}`)
    .join("");
  return `${formula}${followUpText} with ${domain}: ${findFailure(formulas, model)}`;
};

describe("the solver against brute force", () => {
  it("never decides or narrows a formula against an assignment that satisfies it", () => {
    const random = createRandom(SEED);
    const failures = new Set<string>();
    for (let run = 0; run < RUNS; run++) {
      const model = createModel(random);
      const formulas = Array.from({ length: 1 + FOLLOW_UPS }, () =>
        generateFormula(model, random, 0),
      );
      if (findFailure(formulas, model) === null) continue;
      const [smallestFormulas, smallestModel] = shrink(formulas, model);
      failures.add(describeFailure(smallestFormulas, smallestModel));
    }
    expect([...failures].sort()).toEqual([]);
  });
});
