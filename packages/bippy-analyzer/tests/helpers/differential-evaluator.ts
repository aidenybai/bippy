import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { inspect } from "node:util";
import { expect } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../../src/evaluate/values.js";
import { createStaticRenderer } from "../../src/index.js";
import { enumerateStaticStates } from "../../src/harness/compare-render.js";
import { getConcretePatternText } from "./concrete-pattern-text.js";
import type { StaticValue } from "../../src/types.js";

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

const evaluateCases = async (cases: DifferentialCase[], prelude = ""): Promise<StaticValue[]> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-differential-"));
  try {
    const entryPath = join(directory, "program.ts");
    writeFileSync(
      entryPath,
      prelude +
        cases
          .map(({ body }, index) => `export const probe${index} = () => {\n${body}\n};`)
          .join("\n"),
    );
    const renderer = await createStaticRenderer({ rootDirectory: directory, maxSteps: 5_000_000 });
    const actual: StaticValue[] = [];
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(entryPath);
      if (!module) throw new Error("Could not load differential programs");
      const context = interpreter.createModuleContext(module);
      for (let index = 0; index < cases.length; index++) {
        const exported = interpreter.evaluateModuleExport(module, `probe${index}`);
        try {
          actual.push(interpreter.callValue(exported, [], context, null));
        } catch (error) {
          throw new Error(`Analyzer crashed: ${cases[index].name}\n${cases[index].body}`, {
            cause: error,
          });
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

const evaluateNative = (body: string, bindings: Record<string, boolean> = {}): unknown =>
  runInNewContext(`"use strict"; (() => {\n${body}\n})()`, bindings, { timeout: 1000 });

export const checkDifferentialCases = async (cases: DifferentialCase[]): Promise<void> => {
  const expected = cases.map(({ body }) => evaluateNative(body));
  const actual = await evaluateCases(cases);
  const failures: DifferentialFailure[] = [];
  for (let index = 0; index < cases.length; index++) {
    const result = actual[index];
    if (result.kind !== "primitive" || !Object.is(result.value, expected[index])) {
      failures.push({ ...cases[index], expected: expected[index], actual: describeValue(result) });
    }
  }
  if (failures.length) throw new DifferentialMismatch(failures);
};

export const checkKnownDifferentialWitnesses = async (
  cases: DifferentialFailure[],
): Promise<void> => {
  const failure: unknown = await checkDifferentialCases(cases).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual(cases);
};

export const checkSymbolicCases = async (cases: DifferentialCase[]): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-symbolic-differential-"));
  try {
    const entryPath = join(directory, "program.ts");
    writeFileSync(
      entryPath,
      "declare const first: boolean; declare const second: boolean;\n" +
        cases
          .map(({ body }, index) => `export const probe${index} = () => {\n${body}\n};`)
          .join("\n"),
    );
    const renderer = await createStaticRenderer({ rootDirectory: directory });
    for (let index = 0; index < cases.length; index++) {
      const testCase = cases[index];
      const expected = [false, true].flatMap((first) =>
        [false, true].map((second) => evaluateNative(testCase.body, { first, second })),
      );
      const result = await renderer.renderWith((interpreter) => {
        const module = renderer.loadModule(entryPath);
        if (!module) throw new Error("Could not load symbolic differential programs");
        const exported = interpreter.evaluateModuleExport(module, `probe${index}`);
        return interpreter.callValue(exported, [], interpreter.createModuleContext(module), null);
      });
      const states = enumerateStaticStates(result);
      const context = `${testCase.name}\n${testCase.body}`;
      expect(states.omitted, context).toBeNull();
      const actual = states.states.map((state) => getConcretePatternText(state.tree).join(""));
      expect(new Set(actual), context).toEqual(new Set(expected));
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
