import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as concreteEngine from "@engine262/engine262";
import { describe, expect, it } from "vite-plus/test";
import { evaluateSymbolicExpression, SymbolicEngineError } from "../src/index.js";
import { checkScalarExpression, decodeObservation } from "./helpers/scalar-oracle.js";
import { constantGuard, evaluateGuard, negateGuard, truthyGuard } from "../src/symbolic/guards.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { outputDirectory, verifyEngineBuild } from "../engine/manifest.js";
import source from "../engine/source.json" with { type: "json" };

const require = createRequire(import.meta.url);

const scalarValues = [
  "undefined",
  "null",
  "false",
  "true",
  "-0",
  "0",
  "NaN",
  "Infinity",
  "-Infinity",
  "2",
  "'2'",
  "''",
  "2n",
  "0n",
  "-1n",
  "'not a number'",
  "'\\uD800'",
];

const cases = [
  "enabled ? 2 + 3 : 4 * 5",
  "enabled ? 'count: ' + 3 : 'hidden'",
  "enabled ? (other ? 1 : 2) : (other ? 3 : 4)",
  "enabled ? (enabled ? 1 : 1n + 1) : (enabled ? 1n + 1 : 2)",
  "!enabled ? 1 : 2",
  "!!enabled ? 1 : 2",
  "!(enabled) ? (other ? true : false) : null",
  "(1 + 1) > 0 ? (enabled ? 1 : 2) : 3",
  "false ? (enabled ? 1 : 2) : 3",
  "enabled ? 1n + 1 : 2",
  "enabled ? 1 : 1n / 0n",
  "enabled ? 1n / 0n : 1n + 1",
  "(1n + 1) ? (enabled ? 1 : 2) : 3",
  "enabled ? 2n ** 5n : 7n % 3n",
  "enabled ? -0 : 0",
  "enabled ? NaN : Infinity",
  "enabled ? -Infinity : undefined",
  "enabled ? typeof 1n : void 3",
  "enabled ? ~4 : !0",
  "enabled ? '2' == 2 : '2' === 2",
  "enabled ? 3 >= 2 : 3 < 2",
  "enabled ? null : 'null'",
  "enabled ? '\\u{1F680}' : '\\uD800'",
  "enabled ? (other ? 1n + 1 : 3) : (other ? 4 : 1n / 0n)",
  "2 ** 3 + 4 * 5",
  "enabled ? 1 : 2 // trailing comment",
  "enabled",
  "enabled + 1",
  "typeof enabled",
  "enabled === true",
  "enabled && 1",
  "enabled || 1",
  "(enabled ? 1 : 2) + 1",
  "(enabled ? true : false) ? 1 : 2",
  "(enabled ? 1 : 2) + (enabled ? 3 : 4)",
  "(enabled ? 1 : 2) + (other ? 3 : 4)",
  "(enabled ? 'count: ' : 3) + (other ? 2 : 'items')",
  "((enabled ? 2 : 5) * (other ? 3 : 7)) - +enabled",
  "(enabled ? 7 : -7) / (other ? 0 : -0)",
  "(enabled ? 7n : -7n) % (other ? 3n : 0n)",
  "(enabled ? 2n : 2) ** (other ? 3n : -1n)",
  "-(enabled ? 0 : -0)",
  "+(enabled ? 1n : '3')",
  "~(enabled ? 1n : '4294967296')",
  "typeof (enabled ? null : undefined)",
  "void (enabled ? 1n + 1 : 3)",
  "!(enabled ? NaN : Infinity)",
  "(enabled ? NaN : -0) === (other ? NaN : 0)",
  "(enabled ? '2' : 2n) == (other ? 2 : '2')",
  "(enabled ? '2' : 2n) != (other ? 2 : '3')",
  "(enabled ? '2' : 2n) !== (other ? 2 : 2n)",
  "(enabled ? null : undefined) == undefined",
  "(enabled ? '10' : 10n) < (other ? '2' : 2)",
  "(enabled ? NaN : 3) <= (other ? 3n : 4)",
  "(enabled ? NaN : 3) > (other ? 3n : 2)",
  "(enabled ? NaN : 3) >= (other ? 3n : 4)",
  "(+enabled === 1) ? (enabled ? 7 : 1n / 0n) : (enabled ? 1n / 0n : 8)",
  "enabled ? !enabled : enabled",
  "enabled && other",
  "enabled || other",
  "enabled ?? other",
  "(enabled ? null : 0) ?? (other ? 7 : 8)",
  "(enabled ? undefined : false) ?? (other ? 7 : 8)",
  "(enabled ? -0 : 0n) || 'fallback'",
  "(enabled ? '' : NaN) && (1n / 0n)",
  "(enabled ? 'value' : 1n) || (1n / 0n)",
  "(enabled && other) ? (enabled ? 7 : 1n / 0n) : 8",
  "(enabled || other) && (enabled ? !other : other)",
  "(enabled ? 1n / 0n : 2) + (other ? 3 : 4)",
  "(enabled ? 1n : 2) + (other ? 1n / 0n : 3)",
  "(enabled ? 1n + 1 : other) && (other ? 7 : 8)",
  "((enabled ? undefined : 1n / 0n) ?? (other ? 2 : 3)) + 1",
  "(enabled ? (other ? true : false) : false) ? 7 : 8",
  "false && enabled",
  "true || enabled",
  "0 ?? enabled",
];

describe("engine262 symbolic conditional evaluation", () => {
  it("uses map-based input identities, including names inherited by ordinary host objects", async () => {
    const result = await evaluateSymbolicExpression("__proto__ ? 1 : 2", ["__proto__"]);
    expect(result.outcomes).toHaveLength(2);
    expect(
      result.outcomes.map((outcome) =>
        evaluateGuard(outcome.guard, new Map([["__proto__", true]])),
      ),
    ).toEqual([true, false]);
  });

  it("preserves concrete engine dispatch when no symbolic override handles a node", async () => {
    const { api } = await getSymbolicEngine();
    const previousAgent = api.surroundingAgent;
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      const realm = new api.ManagedRealm();
      const result = api.EnsureCompletion(
        realm.evaluateScriptSkipDebugger(
          "const object = { count: 0 }; const increment = () => ++object.count; true ? increment() : increment(); object.count",
        ),
      );
      expect(result).toBeInstanceOf(api.NormalCompletion);
      expect(result.Value).toEqual(api.Value(1));
    } finally {
      api.setSurroundingAgent(previousAgent);
    }
  });
  it.each(cases)(
    "matches unmodified engine262 and Node for all Boolean substitutions: %s",
    (source) => checkScalarExpression(source),
  );

  it.each([
    "+",
    "-",
    "*",
    "/",
    "%",
    "**",
    "==",
    "!=",
    "===",
    "!==",
    "<",
    "<=",
    ">",
    ">=",
    "&&",
    "||",
    "??",
  ])("matches both engines across the guarded scalar matrix: %s", async (operator) => {
    for (const [index, value] of scalarValues.entries()) {
      const alternate = scalarValues[(index + 1) % scalarValues.length];
      const other = scalarValues[(index + 5) % scalarValues.length];
      await checkScalarExpression(
        `(enabled ? ${value} : ${alternate}) ${operator} (other ? ${alternate} : ${other})`,
      );
    }
  });

  it.each(["+", "-", "!", "~", "typeof", "void"])(
    "matches both engines across guarded unary coercions: %s",
    async (operator) => {
      for (const [index, value] of scalarValues.entries()) {
        await checkScalarExpression(
          `${operator} (enabled ? ${value} : ${scalarValues[(index + 1) % scalarValues.length]})`,
        );
      }
    },
  );

  it("runs a common concrete prefix once rather than rerunning the script for input combinations", async () => {
    const result = await evaluateSymbolicExpression("(1 + 1) > 0 ? (enabled ? 1 : 2) : 3", [
      "enabled",
      "unused1",
      "unused2",
      "unused3",
      "unused4",
      "unused5",
      "unused6",
      "unused7",
    ]);
    expect(result.outcomes).toHaveLength(2);
    expect(result.visitedExpressions.filter((source) => source === "1 + 1")).toHaveLength(1);
  });

  it("reuses input identity and never executes contradictory alternatives", async () => {
    const result = await evaluateSymbolicExpression(
      "enabled ? (!enabled ? 1n + 1 : 7) : (enabled ? 1n + 1 : 8)",
      ["enabled"],
    );
    expect(result.outcomes).toHaveLength(2);
    expect(result.visitedExpressions).not.toContain("1n + 1");
    expect(result.outcomes.map((outcome) => decodeObservation(outcome.completion).value)).toEqual([
      7, 8,
    ]);
  });

  it.each([
    "enabled ? 1 in 2 : 3",
    "enabled ? 1 instanceof 2 : 3",
    "enabled && getValue()",
    "true || getValue()",
    "0 ?? object.value",
    "enabled ? (counter = 1) : 2",
    "enabled ? counter++ : 2",
    "enabled ? getValue() : 2",
    "enabled ? ({value:1}) : 2",
    "enabled ? object.value : 2",
    "enabled ? [1,2] : 2",
    "enabled ? (() => 1) : 2",
    "enabled ? delete enabled : 2",
    "enabled ? new Date() : 2",
    "false ? getValue() : 1",
    "missing ? 1 : 2",
    "1); while (true) {}; (2",
  ])("rejects unsupported syntax before evaluating any branch: %s", async (source) => {
    await expect(evaluateSymbolicExpression(source, ["enabled"])).rejects.toBeInstanceOf(
      SymbolicEngineError,
    );
  });

  it("captures guarded syntax visits without changing values, budgets, or the default trace", async () => {
    const source = "(enabled ? 1 : 2) + (other ? 3 : 4)";
    const options = { captureTrace: true };
    const pending = evaluateSymbolicExpression(source, ["enabled", "other"], options);
    options.captureTrace = false;
    const { evaluations, ...traced } = await pending;
    expect(evaluations?.length).toBeGreaterThan(0);
    const normal = await evaluateSymbolicExpression(source, ["enabled", "other"]);
    expect(normal).not.toHaveProperty("evaluations");
    expect(traced).toEqual(normal);
  });

  it("rejects non-Boolean trace flags without coercing them", async () => {
    for (const value of [null, 0, 1, "true", {}, []]) {
      const options = { captureTrace: false };
      Reflect.set(options, "captureTrace", value);
      await expect(evaluateSymbolicExpression("1", [], options)).rejects.toThrow(
        "Trace capture must be a Boolean",
      );
    }
  });

  it("reports the scalar-expression scope and bounds each intermediate or final choice", async () => {
    const result = await evaluateSymbolicExpression("(enabled ? 1 : 2) + 3", ["enabled"], {
      maxOutcomes: 2,
    });
    expect(result.scope).toBe("engine262-pure-scalar-expression-v2");
    expect(result.outcomes).toHaveLength(2);
    await expect(
      evaluateSymbolicExpression("enabled", ["enabled"], { maxOutcomes: 1 }),
    ).rejects.toThrow("outcome budget");
    await expect(
      evaluateSymbolicExpression("enabled + other", ["enabled", "other"], { maxOutcomes: 3 }),
    ).rejects.toThrow("outcome budget");
    const complete = await evaluateSymbolicExpression("enabled + other", ["enabled", "other"], {
      maxOutcomes: 4,
    });
    expect(complete.outcomes).toHaveLength(4);
  });

  it("shares an operand prefix before a symbolic choice", async () => {
    const result = await evaluateSymbolicExpression("(1 + 2) + (enabled ? 3 : 4)", ["enabled"]);
    expect(result.visitedExpressions.filter((source) => source === "1 + 2")).toHaveLength(1);
    expect(result.outcomes.map((outcome) => decodeObservation(outcome.completion).value)).toEqual([
      6, 7,
    ]);
  });

  it("does not evaluate a right operand on paths where the left operand throws", async () => {
    const result = await evaluateSymbolicExpression("(enabled ? 1n / 0n : 2) + (other ? 3 : 4)", [
      "enabled",
      "other",
    ]);
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes[0].completion.kind).toBe("throw");
    expect(result.visitedExpressions.filter((source) => source === "other")).toHaveLength(1);
    expect(evaluateGuard(result.outcomes[0].guard, new Map([["enabled", true]]))).toBe(true);
  });

  it.each([
    "(enabled ? 0 : NaN) && (1n / 0n)",
    "(enabled ? 'value' : 1n) || (1n / 0n)",
    "(enabled ? 0 : false) ?? (1n / 0n)",
  ])("never visits the skipped native short-circuit operand: %s", async (source) => {
    const result = await evaluateSymbolicExpression(source, ["enabled"]);
    expect(result.visitedExpressions).not.toContain("1n / 0n");
    expect(result.outcomes.every((outcome) => outcome.completion.kind === "normal")).toBe(true);
  });

  it("prunes contradictions after native numeric coercion and comparison", async () => {
    const result = await evaluateSymbolicExpression(
      "(+enabled === 1) ? (enabled ? 7 : 1n / 0n) : (enabled ? 1n / 0n : 8)",
      ["enabled"],
    );
    expect(result.visitedExpressions).not.toContain("1n / 0n");
    expect(result.outcomes).toHaveLength(2);
  });

  it("preserves every input correlation without a Cartesian product of repeated choices", async () => {
    const inputs = Array.from({ length: 8 }, (_, index) => `input${index}`);
    const source = inputs.map((input) => `(${input} === ${input})`).join(" && ");
    const result = await evaluateSymbolicExpression(source, inputs, { maxOutcomes: 256 });
    expect(result.outcomes).toHaveLength(256);
    expect(
      result.outcomes.every((outcome) => decodeObservation(outcome.completion).value === true),
    ).toBe(true);
    for (let mask = 0; mask < 256; mask++) {
      const values = new Map(inputs.map((input, index) => [input, Boolean(mask & (1 << index))]));
      expect(
        result.outcomes.filter((outcome) => evaluateGuard(outcome.guard, values)),
      ).toHaveLength(1);
    }
  });

  it("rejects malformed input declarations and invalid source", async () => {
    for (const input of [
      "true",
      "null",
      "undefined",
      "NaN",
      "Infinity",
      "bad-name",
      "name; other",
      "",
    ]) {
      await expect(evaluateSymbolicExpression("1", [input])).rejects.toBeInstanceOf(
        SymbolicEngineError,
      );
    }
    await expect(evaluateSymbolicExpression("enabled ?", ["enabled"])).rejects.toBeInstanceOf(
      SymbolicEngineError,
    );
    await expect(evaluateSymbolicExpression("1", ["enabled", "enabled"])).rejects.toBeInstanceOf(
      SymbolicEngineError,
    );
    await expect(
      evaluateSymbolicExpression(
        "1",
        Array.from({ length: 9 }, (_, index) => `input${index}`),
      ),
    ).rejects.toBeInstanceOf(SymbolicEngineError);
    await expect(evaluateSymbolicExpression(" ".repeat(4097), [])).rejects.toBeInstanceOf(
      SymbolicEngineError,
    );
  });

  it("fails closed on budgets and restores the surrounding agent after every failure", async () => {
    const { api } = await getSymbolicEngine();
    const previousAgent = api.surroundingAgent;
    for (const options of [
      { maxSteps: 1 },
      { maxOutcomes: 1 },
      { maxSteps: 0 },
      { maxOutcomes: -1 },
      { maxSteps: NaN },
    ]) {
      await expect(
        evaluateSymbolicExpression("enabled ? 1 : 2", ["enabled"], options),
      ).rejects.toBeInstanceOf(SymbolicEngineError);
      expect(api.surroundingAgent).toBe(previousAgent);
    }
    await expect(
      evaluateSymbolicExpression("enabled + object.value", ["enabled"]),
    ).rejects.toBeInstanceOf(SymbolicEngineError);
    expect(api.surroundingAgent).toBe(previousAgent);
    expect(
      (await evaluateSymbolicExpression("enabled ? 1 : 2", ["enabled"])).outcomes,
    ).toHaveLength(2);
    expect(api.surroundingAgent).toBe(previousAgent);
  });

  it("restores the surrounding agent when any scalar dispatch exhausts its step budget", async () => {
    const { api } = await getSymbolicEngine();
    const previous = api.surroundingAgent;
    const source = "(enabled ? 1 : 2) + (other ? 3 : 4)";
    const complete = await evaluateSymbolicExpression(source, ["enabled", "other"]);
    for (let maxSteps = 1; maxSteps < complete.steps; maxSteps++) {
      await expect(
        evaluateSymbolicExpression(source, ["enabled", "other"], { maxSteps }),
      ).rejects.toThrow("step budget");
      expect(api.surroundingAgent).toBe(previous);
    }
    expect((await evaluateSymbolicExpression(source, ["enabled", "other"])).outcomes).toEqual(
      complete.outcomes,
    );
  });

  it("isolates overlapping requests and preserves the unmodified engine's surrounding agent", async () => {
    const originalAgent = concreteEngine.surroundingAgent;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        evaluateSymbolicExpression(`enabled ? ${index} : -${index}`, ["enabled"]),
      ),
    );
    expect(results.map((result) => decodeObservation(result.outcomes[0].completion).value)).toEqual(
      Array.from({ length: 12 }, (_, index) => index),
    );
    expect(concreteEngine.surroundingAgent).toBe(originalAgent);
  });

  it("snapshots input names before asynchronous engine loading", async () => {
    const inputs = ["enabled"];
    const pending = evaluateSymbolicExpression("enabled ? 1 : 2", inputs);
    inputs.push(...Array.from({ length: 9 }, (_, index) => `extra${index}`));
    const result = await pending;
    expect(result.inputs).toEqual(["enabled"]);
    expect(result.outcomes).toHaveLength(2);
  });

  it("rejects excessive input-name lengths and expression nesting", async () => {
    await expect(evaluateSymbolicExpression("1", ["a".repeat(129)])).rejects.toBeInstanceOf(
      SymbolicEngineError,
    );
    await expect(
      evaluateSymbolicExpression(`${"(".repeat(129)}1${")".repeat(129)}`, []),
    ).rejects.toThrow("nesting");
  });

  it("preserves PR #115's Boolean guard shape and negation rules", () => {
    const guard = truthyGuard({ input: "enabled", path: [], measure: "value" });
    expect(negateGuard(negateGuard(guard))).toBe(guard);
    expect(negateGuard(constantGuard(true))).toEqual(constantGuard(false));
    expect(evaluateGuard(guard, new Map())).toBeUndefined();
  });

  it("pins the extension to reviewed bytes and leaves the installed engine untouched", async () => {
    const filename = join(dirname(require.resolve("@engine262/engine262")), "engine262.mjs");
    const before = await readFile(filename, "utf8");
    const engine = await getSymbolicEngine();
    expect(createHash("sha256").update(before).digest("hex")).toBe(source.publishedBundleSha256);
    const manifest = await verifyEngineBuild();
    const built = await readFile(join(outputDirectory, "engine.mjs"), "utf8");
    expect(createHash("sha256").update(built).digest("hex")).toBe(engine.patchedSha256);
    expect(manifest.outputs["engine.mjs"]).toBe(engine.patchedSha256);
    expect(built).toContain("//# sourceMappingURL=engine.mjs.map");
    expect(built.match(/hostDefinedOptions\.evaluateNode/g)).toHaveLength(2);
    expect(built.match(/hostDefinedOptions\.evaluateNode\?\.\(/g)).toHaveLength(1);
    expect(await readFile(filename, "utf8")).toBe(before);
  });
});
