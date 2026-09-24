import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { inspect, types } from "node:util";
import { expect } from "vite-plus/test";
import { transformSync } from "esbuild";
import * as React from "react";
import {
  UNDEFINED_VALUE,
  describeValue,
  primitiveValue,
  unknownPrimitiveValue,
} from "../../src/evaluate/values.js";
import { getAlternativeGuards, getTruthinessPredicate } from "../../src/evaluate/predicates.js";
import { areGuardsSatisfiable } from "../../src/symbolic/guard-solver.js";
import { andGuard, negateGuard, type Guard } from "../../src/symbolic/guards.js";
import { parseSymbolicPredicate } from "../../src/symbolic/serialization.js";
import { createStaticRenderer, type StaticRenderer } from "../../src/index.js";
import { enumerateStaticStates } from "../../src/harness/compare-render.js";
import { replayStateSpace } from "../../src/harness/state-replay.js";
import {
  getSsaProfile,
  startSsaProfile,
  stopSsaProfile,
  type SsaFallback,
  type SsaProfile,
} from "../../src/evaluate/ssa-profile.js";
import { getErrorWitness } from "../../src/evaluate/errors.js";
import { getConcretePatternText } from "./concrete-pattern-text.js";
import { getStaticOutcome, type ScalarOutcome } from "./ssa-evaluator.js";
import type { StaticPrimitive, StaticValue } from "../../src/types.js";
import type { Interpreter } from "../../src/evaluate/interpreter.js";
import type { EvaluationContext } from "../../src/evaluate/context.js";

export interface DifferentialCase {
  name: string;
  body: string;
  jsx?: boolean;
  arguments?: Record<string, StaticValue>;
}

export interface FunctionExecution {
  mode: "ssa" | "ast";
  fallback: SsaFallback | null;
}

export interface CaseEvaluation {
  value: StaticValue | null;
  crash: unknown;
  execution: FunctionExecution | null;
}

export interface ObservedValue {
  text: string;
  items?: ObservedValue[];
}

export interface ObservedCompletion {
  kind: "return" | "throw";
  value: ObservedValue;
}

interface GuardedObservation {
  guard: Guard;
  value: ObservedValue;
}

interface ObservationBudget {
  remaining: number;
}

export interface ExpectedDifferentialCase extends DifferentialCase {
  expected: unknown;
}

interface DifferentialFailure extends ExpectedDifferentialCase {
  actual: string;
}

export class DifferentialMismatch extends Error {
  readonly actual: DifferentialFailure[];

  constructor(failures: DifferentialFailure[]) {
    super(`Native/analyzer mismatch:\n${inspect(failures, { depth: null, colors: false })}`);
    this.name = "DifferentialMismatch";
    this.actual = failures;
  }
}

class AnalyzerEvaluationCrash extends Error {
  constructor(testCase: DifferentialCase, cause: unknown) {
    super(`Analyzer crashed: ${testCase.name}\n${testCase.body}`, { cause });
    this.name = "AnalyzerEvaluationCrash";
  }
}

const getProgramSource = (cases: DifferentialCase[], parameters: string[] = []): string => {
  if (cases.length === 0) throw new Error("Differential campaigns must not be empty");
  return cases
    .map(
      (testCase, index) =>
        `export const probe${index} = (${(testCase.arguments ? Object.keys(testCase.arguments) : parameters).join(", ")}) => {\n${testCase.body}\n};`,
    )
    .join("\n");
};

const getFunctionExecution = (
  profile: SsaProfile,
  exported: StaticValue,
): FunctionExecution | null => {
  const record = exported.kind === "function" ? profile.functions.get(exported.node) : undefined;
  if (!record) return null;
  const [fallback] = record.fallbacks.values();
  return record.executions === record.invocations
    ? { mode: "ssa", fallback: null }
    : { mode: "ast", fallback: fallback?.fallback ?? null };
};

const getCaseResult = (
  interpreter: Interpreter,
  exported: StaticValue,
  context: EvaluationContext,
  microtasks: boolean,
  argumentsList: StaticValue[] = [],
): StaticValue => {
  const result = interpreter.callValue(exported, argumentsList, context, null);
  if (!microtasks) return result;
  interpreter.timers.drainMicrotasks();
  return interpreter.callValue(result, [], context, null);
};

export const evaluateCaseOutcomes = async (
  cases: DifferentialCase[],
  microtasks = false,
  prelude = "",
  bindings: Record<string, StaticValue> = {},
  maxSteps = 5_000_000,
): Promise<CaseEvaluation[]> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-differential-"));
  const outerProfile = getSsaProfile();
  const profile = outerProfile ?? startSsaProfile();
  try {
    const entryPath = join(
      directory,
      cases.some((testCase) => testCase.jsx) ? "program.tsx" : "program.ts",
    );
    writeFileSync(entryPath, prelude + getProgramSource(cases, Object.keys(bindings)));
    const renderer = await createStaticRenderer({ rootDirectory: directory, maxSteps });
    const evaluations: CaseEvaluation[] = [];
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(entryPath);
      if (!module) throw new Error("Could not load differential programs");
      for (const [index, testCase] of cases.entries()) {
        const exported = interpreter.evaluateModuleExport(module, `probe${index}`);
        const argumentsList = Object.values(testCase.arguments ?? bindings);
        try {
          const value = getCaseResult(
            interpreter,
            exported,
            interpreter.createModuleContext(module),
            microtasks,
            argumentsList,
          );
          evaluations.push({
            value,
            crash: null,
            execution: getFunctionExecution(profile, exported),
          });
        } catch (error) {
          evaluations.push({ value: null, crash: error, execution: null });
        }
      }
      return UNDEFINED_VALUE;
    });
    expect(evaluations.length, "Every generated program must be evaluated").toBe(cases.length);
    return evaluations;
  } finally {
    if (!outerProfile) stopSsaProfile(profile);
    rmSync(directory, { recursive: true, force: true });
  }
};

export const evaluateCases = async (
  cases: DifferentialCase[],
  microtasks = false,
  prelude = "",
  bindings: Record<string, StaticValue> = {},
): Promise<StaticValue[]> =>
  (await evaluateCaseOutcomes(cases, microtasks, prelude, bindings)).map((evaluation, index) => {
    if (!evaluation.value) throw new AnalyzerEvaluationCrash(cases[index], evaluation.crash);
    return evaluation.value;
  });

const evaluateNative = (
  body: string,
  bindings: Record<string, boolean> = {},
  microtasks = false,
  jsx = false,
): unknown => {
  const prelude = microtasks
    ? "const queueMicrotask = (callback) => { Promise.resolve().then(callback); };"
    : "";
  const source = `"use strict"; ${prelude} (() => {\n${body}\n})()`;
  const result: unknown = runInNewContext(
    jsx
      ? transformSync(source, { loader: "tsx", jsx: "transform", target: "es2022" }).code
      : source,
    jsx ? { React, ...bindings } : bindings,
    {
      timeout: 1000,
      microtaskMode: microtasks ? "afterEvaluate" : undefined,
    },
  );
  if (!microtasks) return result;
  if (typeof result !== "function")
    throw new Error("Microtask programs must return a snapshot function");
  return runInNewContext("snapshot()", { snapshot: result }, { timeout: 1000 });
};

export const checkDifferentialCases = async (
  cases: DifferentialCase[],
  microtasks = false,
): Promise<void> => {
  const expected = cases.map((testCase) =>
    evaluateNative(testCase.body, {}, microtasks, testCase.jsx),
  );
  const actual = await evaluateCases(cases, microtasks);
  const failures: DifferentialFailure[] = [];
  for (let index = 0; index < cases.length; index++) {
    const result = actual[index];
    if (result.kind !== "primitive" || !Object.is(result.value, expected[index])) {
      failures.push({ ...cases[index], expected: expected[index], actual: describeValue(result) });
    }
  }
  if (failures.length) throw new DifferentialMismatch(failures);
};

export const checkExpectedDifferentialCases = async (
  cases: ExpectedDifferentialCase[],
  microtasks = false,
): Promise<void> => {
  for (const testCase of cases)
    expect(evaluateNative(testCase.body, {}, microtasks, testCase.jsx), testCase.name).toEqual(
      testCase.expected,
    );
  await checkDifferentialCases(cases, microtasks);
};

export const checkKnownDifferentialCases = async (
  cases: DifferentialCase[],
  microtasks = false,
): Promise<void> => {
  await expect(checkDifferentialCases(cases, microtasks)).rejects.toBeInstanceOf(
    DifferentialMismatch,
  );
};

export const checkKnownDifferentialWitnesses = async (
  cases: DifferentialFailure[],
  microtasks = false,
): Promise<void> => {
  const failure: unknown = await checkDifferentialCases(cases, microtasks).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual(cases);
};

export const checkKnownSymbolicCases = async (
  cases: DifferentialCase[],
  microtasks = false,
): Promise<void> => {
  await expect(checkSymbolicCases(cases, microtasks)).rejects.toBeInstanceOf(DifferentialMismatch);
};

export const checkSymbolicCases = async (
  cases: DifferentialCase[],
  microtasks = false,
  bindings: Record<string, StaticValue> = {},
): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-symbolic-differential-"));
  try {
    const entryPath = join(
      directory,
      cases.some((testCase) => testCase.jsx) ? "program.tsx" : "program.ts",
    );
    writeFileSync(
      entryPath,
      "declare const first: boolean; declare const second: boolean;\n" +
        getProgramSource(cases, Object.keys(bindings)),
    );
    const renderer = await createStaticRenderer({ rootDirectory: directory });
    for (let index = 0; index < cases.length; index++) {
      const testCase = cases[index];
      const expected = [false, true].flatMap((first) =>
        [false, true].map((second) =>
          evaluateNative(testCase.body, { first, second }, microtasks, testCase.jsx),
        ),
      );
      const render = (currentRenderer: StaticRenderer) =>
        currentRenderer.renderWith((interpreter) => {
          const module = currentRenderer.loadModule(entryPath);
          if (!module) throw new Error("Could not load symbolic differential programs");
          const exported = interpreter.evaluateModuleExport(module, `probe${index}`);
          const value = getCaseResult(
            interpreter,
            exported,
            interpreter.createModuleContext(module),
            microtasks,
            Object.values(bindings),
          );
          if (value.kind === "unknown-primitive") {
            throw new DifferentialMismatch([
              { ...testCase, expected, actual: describeValue(value) },
            ]);
          }
          return value;
        });
      const states = enumerateStaticStates(await render(renderer));
      const context = `${testCase.name}\n${testCase.body}`;
      expect(states.unresolved, context).toBeNull();
      expect(states.omitted, context).toBeNull();
      const actual = states.states.map((state) => getConcretePatternText(state.tree).join(""));
      const actualSet = new Set(actual);
      const expectedSet = new Set(expected);
      if (actualSet.size !== expectedSet.size || actual.some((value) => !expectedSet.has(value))) {
        throw new DifferentialMismatch([
          { ...testCase, expected: [...expectedSet], actual: inspect([...actualSet]) },
        ]);
      }
      const replay = await replayStateSpace(
        states,
        (decisions) => render(renderer.derive({ decisions })),
        null,
      );
      expect(replay.summary.replayed, context).toBe(replay.summary.assignments);
      expect(replay.summary.mismatched, context).toEqual([]);
      expect(replay.summary.incomplete, context).toEqual([]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

export const getGuardedOutcomes = (
  value: StaticValue,
  guard: Guard,
  isThrown = false,
): ScalarOutcome[] => {
  if (!areGuardsSatisfiable([guard])) return [];
  if (value.kind === "branch") {
    const resolved = getAlternativeGuards(value);
    if (!resolved) return [{ kind: "unresolved", value: describeValue(value) }];
    return value.alternatives.flatMap((alternative, index) =>
      getGuardedOutcomes(alternative, andGuard([guard, resolved.guards[index]]), isThrown),
    );
  }
  if (!isThrown && value.kind === "unknown" && value.thrown)
    return getGuardedOutcomes(value.thrown, guard, true);
  return [getStaticOutcome(value, isThrown)];
};

export const encodePrimitive = (value: unknown): string => {
  if (value === undefined || value === null) return String(value);
  if (typeof value === "number") return `number:${Object.is(value, -0) ? "-0" : value}`;
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (typeof value === "symbol") return `symbol:${String(value.description)}`;
  return `${typeof value}:${String(value)}`;
};

export const decodePrimitive = (text: string): StaticPrimitive => {
  if (text === "undefined") return undefined;
  if (text === "null") return null;
  const separator = text.indexOf(":");
  const kind = text.slice(0, separator);
  const payload = text.slice(separator + 1);
  if (kind === "number") return payload === "-0" ? -0 : Number(payload);
  if (kind === "bigint") return BigInt(payload);
  if (kind === "boolean") return payload === "true";
  if (kind === "string") {
    const decoded: unknown = JSON.parse(payload);
    if (typeof decoded === "string") return decoded;
  }
  throw new Error(`Cannot decode primitive ${text}`);
};

export const observeNative = (value: unknown): ObservedValue => {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return { text: "list", items: items.map(observeNative) };
  }
  if (types.isNativeError(value)) return { text: `error:${value.name}` };
  if (typeof value === "function") return { text: "function" };
  if (typeof value === "object" && value !== null) return { text: "object" };
  return { text: encodePrimitive(value) };
};

const MAX_OBSERVATION_STEPS = 10_000;

/** Nested lists cross their items' alternatives, so one budget bounds a whole completion. */
const observeStatic = (
  value: StaticValue,
  guard: Guard,
  budget: ObservationBudget,
): GuardedObservation[] => {
  if (--budget.remaining < 0) return [{ guard, value: { text: "unresolved:observation budget" } }];
  if (!areGuardsSatisfiable([guard])) return [];
  if (value.kind === "branch") {
    const resolved = getAlternativeGuards(value);
    if (!resolved) return [{ guard, value: { text: `unresolved:${describeValue(value)}` } }];
    return value.alternatives.flatMap((alternative, index) =>
      observeStatic(alternative, andGuard([guard, resolved.guards[index]]), budget),
    );
  }
  if (value.kind === "primitive") return [{ guard, value: { text: encodePrimitive(value.value) } }];
  const truthiness =
    value.kind === "unknown-primitive" && value.primitiveType === "boolean"
      ? parseSymbolicPredicate(getTruthinessPredicate(value)).formula
      : null;
  if (truthiness)
    return [true, false].flatMap((isTruthy) =>
      observeStatic(
        primitiveValue(isTruthy),
        andGuard([guard, isTruthy ? truthiness : negateGuard(truthiness)]),
        budget,
      ),
    );
  if (value.kind === "list") {
    let prefixes: GuardedObservation[] = [{ guard, value: { text: "list", items: [] } }];
    for (const item of value.items)
      prefixes = prefixes.flatMap((prefix) =>
        observeStatic(item, prefix.guard, budget).map((observed) => ({
          guard: observed.guard,
          value: { text: "list", items: [...(prefix.value.items ?? []), observed.value] },
        })),
      );
    return prefixes;
  }
  const witness = value.kind === "object" ? getErrorWitness(value) : null;
  if (witness) return [{ guard, value: { text: `error:${witness.name}` } }];
  const [inherited] = value.kind === "object" && value.constructedBy ? value.entries : [];
  if (inherited?.kind === "spread" && inherited.value.kind === "unknown")
    return [{ guard, value: { text: `unresolved:${describeValue(inherited.value)}` } }];
  if (value.kind === "object") return [{ guard, value: { text: "object" } }];
  if (value.kind === "function" || value.kind === "native-function")
    return [{ guard, value: { text: "function" } }];
  return [{ guard, value: { text: `unresolved:${describeValue(value)}` } }];
};

export const observeCompletion = (
  value: StaticValue,
  guard: Guard,
  budget: ObservationBudget = { remaining: MAX_OBSERVATION_STEPS },
): ObservedCompletion[] => {
  if (!areGuardsSatisfiable([guard])) return [];
  if (value.kind === "branch") {
    const resolved = getAlternativeGuards(value);
    if (resolved)
      return value.alternatives.flatMap((alternative, index) =>
        observeCompletion(alternative, andGuard([guard, resolved.guards[index]]), budget),
      );
  }
  if (value.kind === "unknown" && value.thrown)
    return observeStatic(value.thrown, guard, budget).map((observed) => ({
      kind: "throw",
      value: observed.value,
    }));
  return observeStatic(value, guard, budget).map((observed) => ({
    kind: "return",
    value: observed.value,
  }));
};

export const getBooleanInputGuards = (inputs: StaticValue[]): Guard[] =>
  inputs.map((input) => {
    const predicate = parseSymbolicPredicate(getTruthinessPredicate(input));
    if (!predicate.formula) throw new Error("Expected a Boolean input predicate");
    return predicate.formula;
  });

export const getAssignmentGuard = (guards: Guard[], assignment: boolean[]): Guard =>
  andGuard(guards.map((guard, index) => (assignment[index] ? guard : negateGuard(guard))));

export const checkGuardedCases = async (
  cases: DifferentialCase[],
  microtasks = false,
): Promise<void> => {
  const bindings = {
    first: unknownPrimitiveValue("boolean", "first"),
    second: unknownPrimitiveValue("boolean", "second"),
  };
  const guards = getBooleanInputGuards(Object.values(bindings));
  const results = await evaluateCases(cases, microtasks, "", bindings);
  for (const [index, testCase] of cases.entries()) {
    for (const first of [false, true]) {
      for (const second of [false, true]) {
        let expected: ScalarOutcome;
        try {
          expected = {
            kind: "return",
            value: evaluateNative(testCase.body, { first, second }, microtasks, testCase.jsx),
          };
        } catch (error) {
          expected = types.isNativeError(error)
            ? { kind: "error", value: error.name }
            : { kind: "throw", value: error };
        }
        const actual = getGuardedOutcomes(
          results[index],
          getAssignmentGuard(guards, [first, second]),
        );
        const context = `${testCase.name}: first=${first}, second=${second}\n${testCase.body}`;
        expect(actual.length, context).toBeGreaterThan(0);
        for (const outcome of actual) expect(outcome, context).toEqual(expected);
      }
    }
  }
};

export const createSeededRandom = (seed: number): ((limit: number) => number) => {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * limit);
  };
};

export const differentialSeeds = [0, 1, 42, 0xdeadbeef, 0xffffffff];
