import * as published from "@engine262/engine262";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { BooleanValue, Value } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

interface ExpressionCase {
  name: string;
  expression: string;
  decisions?: number;
}
interface ExpressionObservation {
  completion: string;
  type: string;
  value: string;
  trace: string;
}
interface DrivenResult {
  completion: ReturnType<AbstractFixture["evaluate"]>;
  decisions: BooleanValue[];
}

const runDecisions = (
  fixture: AbstractFixture,
  source: string,
  assignments: ReadonlyMap<BooleanValue, boolean>,
): DrivenResult => {
  const decisions: BooleanValue[] = [];
  const iterator = fixture.compile(source);
  let step = iterator.next();
  while (!step.done) {
    if (step.value.suspend === "abstract-boolean") {
      const decision = step.value;
      const choice = assignments.get(decision.value);
      if (choice === undefined || decisions.length >= 20) throw new Error("Unexpected decision");
      decisions.push(decision.value);
      step = iterator.next({ resume: "abstract-boolean", decision, value: choice });
    } else {
      if (step.value.suspend !== "debugger" && step.value.suspend !== "potential-debugger")
        throw new Error("Unexpected suspension");
      step = iterator.next({ resume: "debugger", value: undefined });
    }
  }
  return { completion: fixture.api.EnsureCompletion(step.value), decisions };
};

const cases: ExpressionCase[] = [
  {
    name: "conditional",
    expression: "read('enabled', enabled) ? read('yes', 11) : read('no', 22)",
  },
  { name: "and", expression: "read('enabled', enabled) && read('right', fail)" },
  { name: "or", expression: "read('enabled', enabled) || read('right', fail)" },
  { name: "not", expression: "!read('enabled', enabled)" },
  { name: "double not", expression: "!!read('enabled', enabled)" },
  { name: "and condition", expression: "(enabled && fail) ? read('yes', 1) : read('no', 2)" },
  { name: "or condition", expression: "(enabled || fail) ? read('yes', 1) : read('no', 2)" },
  { name: "nested", expression: "enabled ? (fail ? 1 : 2) : (fail ? 3 : 4)" },
  {
    name: "repeated",
    expression: "enabled ? (!enabled ? explode() : 1) : (enabled ? explode() : 2)",
  },
  { name: "and skipped throw", expression: "enabled && explode()" },
  { name: "or skipped throw", expression: "enabled || explode()" },
  { name: "conditional throw", expression: "enabled ? explode() : 9" },
  {
    name: "condition throws first",
    expression: "read('first', explode()) ? enabled : fail",
    decisions: 0,
  },
  {
    name: "getter",
    expression: `({
        get value() {
          trace.push("get");
          return enabled;
        },
      }).value
        ? 1
        : 2`,
  },
  { name: "receiver", expression: "(enabled ? owner.method : owner.method)()" },
  { name: "and receiver", expression: "((enabled && owner.method) || owner.method)()" },
  { name: "or receiver", expression: "((enabled || owner.method) && owner.method)()" },
  { name: "nullish preserves input", expression: "(enabled ?? explode()) ? 1 : 2" },
  { name: "conditional returns input", expression: "enabled ? fail : enabled" },
  {
    name: "concrete short circuits",
    expression: "(0 && enabled) || ('kept' || fail)",
    decisions: 0,
  },
  {
    name: "abrupt finally",
    expression: `(() => {
        try {
          return enabled && explode();
        } finally {
          trace.push("finally");
        }
      })()`,
  },
  {
    name: "finally overrides",
    expression: `(() => {
        try {
          return !enabled;
        } finally {
          return fail ? 3 : 4;
        }
      })()`,
  },
  {
    name: "generator",
    expression: `(() => {
        function* run() {
          return enabled ? !fail : fail;
        }
        return run().next().value;
      })()`,
  },
  {
    name: "callee evaluation",
    expression: "(read('callee', enabled) ? owner.method : owner.method)(read('argument', 7))",
  },
];

const getSource = (expression: string): string => `
  var trace = [];
  var read = (name, value) => {
    trace.push(name);
    return value;
  };
  var explode = () => {
    trace.push("throw");
    throw 23;
  };
  var owner = {
    method: function () {
      "use strict";
      trace.push(this === undefined ? "unbound" : "bound");
      return 31;
    },
  };
  try {
    ${expression};
  } catch (error) {
    if (typeof error === "number") throw error;
    throw error.name;
  }
`;

const getNativeObservation = (
  source: string,
  enabled: boolean,
  fail: boolean,
): ExpressionObservation => {
  const context = { enabled, fail, trace: [] };
  let completion = "normal";
  let value: unknown;
  try {
    value = runInNewContext(source, context, { timeout: 1000 });
  } catch (error) {
    completion = "throw";
    value = error;
  }
  return {
    completion,
    type: typeof value,
    value: String(value),
    trace: JSON.stringify(context.trace),
  };
};

const getPublishedObservation = (
  source: string,
  enabled: boolean,
  fail: boolean,
): ExpressionObservation => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const realm = new published.ManagedRealm();
    const completion = published.EnsureCompletion(
      realm.evaluateScriptSkipDebugger(`
        var enabled = ${enabled},
          fail = ${fail};
        ${source}
      `),
    );
    const value = completion.Value;
    const trace = published.EnsureCompletion(
      realm.evaluateScriptSkipDebugger("JSON.stringify(trace)"),
    );
    if (!(trace.Value instanceof published.JSStringValue)) throw new Error("Expected trace");
    const concrete =
      value instanceof published.BooleanValue
        ? value.booleanValue()
        : value instanceof published.NumberValue
          ? value.numberValue()
          : value instanceof published.JSStringValue
            ? value.stringValue()
            : undefined;
    if (concrete === undefined && value !== published.Value.undefined)
      throw new Error("Unexpected result");
    return {
      completion: completion.Type,
      type: typeof concrete,
      value: String(concrete),
      trace: trace.Value.stringValue(),
    };
  } finally {
    published.setSurroundingAgent(previous);
  }
};

const getSpecializedValue = (
  fixture: AbstractFixture,
  value: Value,
  assignments: ReadonlyMap<BooleanValue, boolean>,
): unknown => {
  if (value instanceof fixture.api.BooleanValue) {
    if (!fixture.api.BooleanValue.isAbstract(value)) return value.booleanValue();
    if (!assignments.has(value)) throw new Error("Unknown result input");
    return assignments.get(value);
  }
  if (value instanceof fixture.api.NumberValue) return value.numberValue();
  if (value instanceof fixture.api.JSStringValue) return value.stringValue();
  if (value === fixture.api.Value.undefined) return undefined;
  throw new Error("Unexpected result");
};

for (const enabled of [false, true]) {
  for (const fail of [false, true]) {
    it.each(cases)(
      `preserves $name evaluation and completion, enabled=${enabled}, fail=${fail}`,
      async ({ expression, decisions: expectedDecisions }) => {
        const source = getSource(expression);
        await withAbstractFixture((fixture) => {
          const enabledInput = fixture.createBoolean("enabled");
          const failInput = fixture.createBoolean("fail");
          const assignments = new Map([
            [enabledInput, enabled],
            [failInput, fail],
          ]);
          const { completion, decisions } = runDecisions(fixture, source, assignments);
          if (expectedDecisions !== undefined) expect(decisions).toHaveLength(expectedDecisions);
          const value = getSpecializedValue(fixture, completion.Value, assignments);
          const trace = fixture.evaluate("JSON.stringify(trace)");
          if (!(trace.Value instanceof fixture.api.JSStringValue))
            throw new Error("Expected trace");
          const observation = {
            completion: completion.Type,
            type: typeof value,
            value: String(value),
            trace: trace.Value.stringValue(),
          };
          expect(observation).toEqual(getNativeObservation(source, enabled, fail));
          expect(observation).toEqual(getPublishedObservation(source, enabled, fail));
          expect(fixture.evaluate("enabled").Value).toBe(enabledInput);
          expect(fixture.evaluate("fail").Value).toBe(failInput);
        });
      },
    );
  }
}

it.each([false, true])(
  "rejects diagnostic payload reads for an opaque non-callable: %s",
  async (choice) => {
    await withAbstractFixture((fixture) => {
      const input = fixture.createBoolean("enabled");
      expect(() =>
        runDecisions(
          fixture,
          choice ? "(enabled || (()=>17))()" : "(enabled && (()=>17))()",
          new Map([[input, choice]]),
        ),
      ).toThrow("Unsupported concrete read of abstract Boolean");
    });
  },
);

it.each([false, true])("preserves the short-circuited operand identity: %s", async (choice) => {
  await withAbstractFixture((fixture) => {
    const input = fixture.createBoolean("enabled");
    const { completion, decisions } = runDecisions(
      fixture,
      choice ? "enabled || 17" : "enabled && 17",
      new Map([[input, choice]]),
    );
    expect(completion.Value).toBe(input);
    expect(decisions).toEqual([input]);
  });
});

it.each([false, true])("reuses the opaque operand in nested Boolean tests: %s", async (choice) => {
  await withAbstractFixture((fixture) => {
    const input = fixture.createBoolean("enabled");
    const { completion, decisions } = runDecisions(
      fixture,
      choice ? "if(enabled || 17) 1;else 2;" : "if(enabled && 17) 1;else 2;",
      new Map([[input, choice]]),
    );
    expect(completion.Value).toEqual(fixture.api.Value(choice ? 1 : 2));
    expect(decisions).toEqual([input, input]);
  });
});

it.each(["enabled ? 1 : 2", "enabled && 2", "enabled || 2", "!enabled"])(
  "requires a decision driver for %s",
  async (source) => {
    await withAbstractFixture(({ createBoolean, evaluate }) => {
      createBoolean("enabled");
      expect(() => evaluate(source)).toThrow(
        "Abstract Boolean decision requires an explicit resume",
      );
    });
  },
);
