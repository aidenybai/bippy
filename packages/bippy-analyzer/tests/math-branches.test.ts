import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { EvaluationContext } from "../src/evaluate/context.js";
import type { Interpreter } from "../src/evaluate/interpreter.js";
import { createPathPredicate, getBranchPredicate } from "../src/evaluate/predicates.js";
import { nativeFunction } from "../src/evaluate/stubs.js";
import {
  branchValue,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
} from "../src/evaluate/values.js";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { createStaticRenderer } from "../src/index.js";
import { listComponentFixtures, runComponentFixture } from "./helpers/component-runner.js";
import { getConcretePatternText } from "./helpers/concrete-pattern-text.js";

interface MathCase {
  name: string;
  compute: (value: number) => number;
  tail: number[];
}
interface MathCheck {
  (interpreter: Interpreter, context: EvaluationContext): void;
}
const checkMath = async (check: MathCheck): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-math-branches-"));
  try {
    const filename = join(directory, "module.ts");
    writeFileSync(filename, "export {};\n", { flag: "wx" });
    const renderer = await createStaticRenderer({ rootDirectory: directory });
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(filename);
      if (!module) throw new Error("Missing math module");
      check(interpreter, interpreter.createModuleContext(module));
      return UNDEFINED_VALUE;
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
};
const cases: MathCase[] = [
  { name: "min", compute: (value) => Math.min(value, 3), tail: [3] },
  { name: "max", compute: (value) => Math.max(value, -3), tail: [-3] },
  { name: "abs", compute: Math.abs, tail: [] },
  { name: "floor", compute: Math.floor, tail: [] },
  { name: "ceil", compute: Math.ceil, tail: [] },
  { name: "round", compute: Math.round, tail: [] },
  { name: "sign", compute: Math.sign, tail: [] },
  { name: "sqrt", compute: Math.sqrt, tail: [] },
  { name: "pow", compute: (value) => Math.pow(value, 3), tail: [3] },
  { name: "imul", compute: (value) => Math.imul(value, 2), tail: [2] },
];

describe("finite Math arguments", () => {
  it.each(cases)(
    "preserves Math.$name outcomes, guards, and preference",
    async ({ name, compute, tail }) => {
      await checkMath((interpreter, context) => {
        const predicate = createPathPredicate("math input", null);
        const argument = branchValue(
          [primitiveValue(-4.5), primitiveValue(2.5)],
          "math input",
          null,
          1,
          predicate,
        );
        const result = interpreter.callValue(
          { kind: "global", name: `Math.${name}` },
          [argument, ...tail.map(primitiveValue)],
          context,
          null,
        );
        expect(result).toMatchObject({
          kind: "branch",
          alternatives: [primitiveValue(compute(-4.5)), primitiveValue(compute(2.5))],
          preferredIndex: 1,
        });
        if (result.kind === "branch" && argument.kind === "branch")
          expect(getBranchPredicate(result)).toBe(getBranchPredicate(argument));
      });
    },
  );

  it("preserves signed zero", async () => {
    await checkMath((interpreter, context) => {
      const argument = branchValue([primitiveValue(-0), primitiveValue(0)], "zero sign");
      const result = interpreter.callValue(
        { kind: "global", name: "Math.min" },
        [argument, primitiveValue(Infinity)],
        context,
        null,
      );
      expect(result).toMatchObject({
        kind: "branch",
        alternatives: [primitiveValue(-0), primitiveValue(0)],
      });
    });
  });

  it.each([8, 9])(
    "retains the existing eight-combination limit for %i alternatives",
    async (count) => {
      await checkMath((interpreter, context) => {
        const argument = branchValue(
          Array.from({ length: count }, (_, index) => primitiveValue(index + 1)),
          "finite numbers",
        );
        const result = interpreter.callValue(
          { kind: "global", name: "Math.abs" },
          [argument],
          context,
          null,
        );
        expect(result.kind).toBe(count === 8 ? "branch" : "unknown-primitive");
        if (result.kind === "branch") expect(result.alternatives).toHaveLength(8);
      });
    },
  );

  it("does not distribute object or bigint coercion", async () => {
    await checkMath((interpreter, context) => {
      let nativeCalls = 0;
      const coercible = objectFromRecord({
        valueOf: nativeFunction("valueOf", () => {
          nativeCalls++;
          return primitiveValue(1);
        }),
      });
      const argument = branchValue([primitiveValue(1), primitiveValue(2)], "numeric choice");
      for (const other of [coercible, primitiveValue(1n)]) {
        const result = interpreter.callValue(
          { kind: "global", name: "Math.min" },
          [argument, other],
          context,
          null,
        );
        expect(result.kind).toBe("unknown-primitive");
      }
      expect(nativeCalls).toBe(0);
    });
  });

  it.each([
    { name: "math-bounded-matches.tsx", expected: ["child", "root"] },
    { name: "math-correlated-arguments.tsx", expected: ["-4", "6"] },
  ])("keeps the primary model finite for $name", async ({ name, expected }) => {
    const fixture = listComponentFixtures().find((candidate) => candidate.name === name);
    if (!fixture) throw new Error(`Missing ${name}`);
    const result = await runComponentFixture(fixture);
    const model = enumerateStaticStates(result.staticResult);
    expect(model.omitted).toBeNull();
    expect(
      [...new Set(model.states.flatMap((state) => getConcretePatternText(state.tree)))].sort(),
    ).toEqual(expected);
    expect(result.comparison.report.status).toBe("exact");
    expect(result.comparison.stateReplay?.mismatched).toEqual([]);
  });
});
