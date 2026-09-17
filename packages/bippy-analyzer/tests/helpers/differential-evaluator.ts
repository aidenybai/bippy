import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { inspect } from "node:util";
import { expect } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../../src/evaluate/values.js";
import { createStaticRenderer, type StaticRenderer } from "../../src/index.js";
import { enumerateStaticStates } from "../../src/harness/compare-render.js";
import { replayStateSpace } from "../../src/harness/state-replay.js";
import { getConcretePatternText } from "./concrete-pattern-text.js";
import type { StaticValue } from "../../src/types.js";
import type { Interpreter } from "../../src/evaluate/interpreter.js";
import type { EvaluationContext } from "../../src/evaluate/context.js";

export interface DifferentialCase {
  name: string;
  body: string;
}

interface DifferentialFailure extends DifferentialCase {
  expected: unknown;
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

const getProgramSource = (cases: DifferentialCase[]): string => {
  if (cases.length === 0) throw new Error("Differential campaigns must not be empty");
  return cases
    .map(({ body }, index) => `export const probe${index} = () => {\n${body}\n};`)
    .join("\n");
};

const getCaseResult = (
  interpreter: Interpreter,
  exported: StaticValue,
  context: EvaluationContext,
  microtasks: boolean,
): StaticValue => {
  const result = interpreter.callValue(exported, [], context, null);
  if (!microtasks) return result;
  interpreter.timers.drainMicrotasks();
  return interpreter.callValue(result, [], context, null);
};

const evaluateCases = async (
  cases: DifferentialCase[],
  microtasks = false,
): Promise<StaticValue[]> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-differential-"));
  try {
    const entryPath = join(directory, "program.ts");
    writeFileSync(entryPath, getProgramSource(cases));
    const renderer = await createStaticRenderer({ rootDirectory: directory, maxSteps: 5_000_000 });
    const actual: StaticValue[] = [];
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(entryPath);
      if (!module) throw new Error("Could not load differential programs");
      const context = interpreter.createModuleContext(module);
      for (let index = 0; index < cases.length; index++) {
        const exported = interpreter.evaluateModuleExport(module, `probe${index}`);
        try {
          actual.push(getCaseResult(interpreter, exported, context, microtasks));
        } catch (error) {
          throw new AnalyzerEvaluationCrash(cases[index], error);
        }
      }
      return UNDEFINED_VALUE;
    });
    expect(actual.length, "Every generated program must be evaluated").toBe(cases.length);
    return actual;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const evaluateNative = (
  body: string,
  bindings: Record<string, boolean> = {},
  microtasks = false,
): unknown => {
  const prelude = microtasks
    ? "const queueMicrotask = (callback) => { Promise.resolve().then(callback); };"
    : "";
  const result: unknown = runInNewContext(
    `"use strict"; ${prelude} (() => {\n${body}\n})()`,
    bindings,
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
  const expected = cases.map(({ body }) => evaluateNative(body, {}, microtasks));
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
): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-symbolic-differential-"));
  try {
    const entryPath = join(directory, "program.ts");
    writeFileSync(
      entryPath,
      "declare const first: boolean; declare const second: boolean;\n" + getProgramSource(cases),
    );
    const renderer = await createStaticRenderer({ rootDirectory: directory });
    for (let index = 0; index < cases.length; index++) {
      const testCase = cases[index];
      const expected = [false, true].flatMap((first) =>
        [false, true].map((second) => evaluateNative(testCase.body, { first, second }, microtasks)),
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

export const createSeededRandom = (seed: number): ((limit: number) => number) => {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * limit);
  };
};

export const differentialSeeds = [0, 1, 42, 0xdeadbeef, 0xffffffff];
