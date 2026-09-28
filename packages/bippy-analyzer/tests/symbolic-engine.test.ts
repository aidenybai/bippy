import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as concreteEngine from "@engine262/engine262";
import { describe, expect, it } from "vite-plus/test";
import {
  evaluateSymbolicExpression,
  SymbolicEngineError,
  type NormalObservation,
  type ThrowObservation,
} from "../src/index.js";
import { constantGuard, evaluateGuard, negateGuard, truthyGuard } from "../src/symbolic/guards.js";
import {
  getPatchedEngineSource,
  getSymbolicEngine,
  ORIGINAL_ENGINE_SHA256,
} from "../src/symbolic/load-engine.js";

const require = createRequire(import.meta.url);

interface ConcreteResult {
  kind: "normal" | "throw";
  value?: unknown;
  name?: string;
  message?: string;
}

const getConcreteResult = (
  source: string,
  inputs: ReadonlyMap<string, boolean>,
): ConcreteResult => {
  const previousAgent = concreteEngine.surroundingAgent;
  concreteEngine.setSurroundingAgent(new concreteEngine.Agent({ startEventLoop: false }));
  try {
    const realm = new concreteEngine.ManagedRealm();
    const declarations = Array.from(inputs, ([name, value]) => `const ${name} = ${value};`).join(
      "\n",
    );
    const result = concreteEngine.EnsureCompletion(
      realm.evaluateScriptSkipDebugger(`${declarations}\n(${source}\n)`),
    );
    if (result instanceof concreteEngine.ThrowCompletion) {
      const name = concreteEngine.EnsureCompletion(
        realm.evaluateScriptSkipDebugger(
          `try { ${declarations} (${source}\n); } catch (error) { error.name; }`,
        ),
      );
      const message = concreteEngine.EnsureCompletion(
        realm.evaluateScriptSkipDebugger(
          `try { ${declarations} (${source}\n); } catch (error) { error.message; }`,
        ),
      );
      expect(name).toBeInstanceOf(concreteEngine.NormalCompletion);
      expect(message).toBeInstanceOf(concreteEngine.NormalCompletion);
      return {
        kind: "throw",
        name:
          name.Value instanceof concreteEngine.JSStringValue ? name.Value.stringValue() : undefined,
        message:
          message.Value instanceof concreteEngine.JSStringValue
            ? message.Value.stringValue()
            : undefined,
      };
    }
    const value = result.Value;
    if (value instanceof concreteEngine.NumberValue)
      return { kind: "normal", value: value.numberValue() };
    if (value instanceof concreteEngine.BigIntValue)
      return { kind: "normal", value: value.bigintValue() };
    if (value instanceof concreteEngine.JSStringValue)
      return { kind: "normal", value: value.stringValue() };
    if (value instanceof concreteEngine.BooleanValue) return { kind: "normal", value: value.value };
    if (value instanceof concreteEngine.NullValue) return { kind: "normal", value: null };
    if (value instanceof concreteEngine.UndefinedValue) return { kind: "normal", value: undefined };
    throw new SymbolicEngineError("Unexpected concrete fixture result");
  } finally {
    concreteEngine.setSurroundingAgent(previousAgent);
  }
};

const decodeObservation = (observation: NormalObservation | ThrowObservation): ConcreteResult => {
  if (observation.kind === "throw") return observation;
  const { value } = observation;
  switch (value.type) {
    case "Number":
      return { kind: "normal", value: Number(value.value) };
    case "BigInt":
      return { kind: "normal", value: BigInt(String(value.value)) };
    case "Undefined":
      return { kind: "normal", value: undefined };
    default:
      return { kind: "normal", value: value.value };
  }
};

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
    "matches the unmodified engine for all Boolean substitutions: %s",
    async (source) => {
      const result = await evaluateSymbolicExpression(source, ["enabled", "other"]);
      const restored = JSON.parse(JSON.stringify(result));
      expect(restored).toEqual(result);
      for (const enabled of [false, true]) {
        for (const other of [false, true]) {
          const inputs = new Map([
            ["enabled", enabled],
            ["other", other],
          ]);
          const matching = result.outcomes.filter(
            (outcome) => evaluateGuard(outcome.guard, inputs) === true,
          );
          expect(matching).toHaveLength(1);
          expect(decodeObservation(matching[0].completion)).toEqual(
            getConcreteResult(source, inputs),
          );
        }
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
    "enabled",
    "enabled + 1",
    "typeof enabled",
    "enabled === true",
    "enabled && 1",
    "enabled || 1",
    "(enabled ? 1 : 2) + 1",
    "(enabled ? true : false) ? 1 : 2",
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
    await expect(evaluateSymbolicExpression("enabled + 1", ["enabled"])).rejects.toBeInstanceOf(
      SymbolicEngineError,
    );
    expect(api.surroundingAgent).toBe(previousAgent);
    expect(
      (await evaluateSymbolicExpression("enabled ? 1 : 2", ["enabled"])).outcomes,
    ).toHaveLength(2);
    expect(api.surroundingAgent).toBe(previousAgent);
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
    expect(createHash("sha256").update(before).digest("hex")).toBe(ORIGINAL_ENGINE_SHA256);
    const patched = getPatchedEngineSource(before);
    expect(createHash("sha256").update(patched).digest("hex")).toBe(engine.patchedSha256);
    expect(patched).not.toContain("//# sourceMappingURL=");
    expect(patched.match(/hostDefinedOptions\.evaluateNode/g)).toHaveLength(1);
    expect(() => getPatchedEngineSource(`${before}\n`)).toThrow(SymbolicEngineError);
    expect(await readFile(filename, "utf8")).toBe(before);
  });
});
