import * as published from "@engine262/engine262";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  createNumericDomain,
  type NumericExpression,
  type NumericPredicate,
} from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";
import { getExpressionSource, getPredicateSource } from "./helpers/numeric-expression.js";

interface GuardedState {
  choice: boolean;
  guard: NumericPredicate;
  value: NumericExpression;
  tag: string;
}

const witnesses = [
  NaN,
  Infinity,
  -Infinity,
  -0,
  0,
  1,
  -1,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.EPSILON,
  -Number.EPSILON,
  2 ** 53,
  -(2 ** 53),
  Number.MAX_SAFE_INTEGER,
  -Number.MAX_SAFE_INTEGER,
];

const bailoutSource = `
  let prefix = 0;
  prefix++;
  const state = { value: amount, tag: "pending" };
  const candidate = amount + 1;
  const same = Object.is(candidate, amount);
  if (!same) state.value = candidate;
  if (Object.is(amount, candidate)) state.tag = "bailout";
  else state.tag = "update";
`;

const getBoolean = (fixture: AbstractFixture, source: string) => {
  const completion = fixture.evaluate(source);
  if (completion.Type !== "normal" || !(completion.Value instanceof fixture.api.BooleanValue))
    throw new Error("Expected a normal engine Boolean");
  return completion.Value;
};

const getNumberSource = (value: number): string => (Object.is(value, -0) ? "-0" : String(value));

const getPublished = (source: string, amount: number, other = 0): boolean => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const realm = new published.ManagedRealm();
    const result = published.EnsureCompletion(
      realm.evaluateScriptSkipDebugger(
        `
          var amount = ${getNumberSource(amount)},
            other = ${getNumberSource(other)};
          ${source}
        `,
      ),
    );
    if (result.Type !== "normal" || !(result.Value instanceof published.BooleanValue))
      throw new Error("Expected a published Boolean");
    return result.Value.booleanValue();
  } finally {
    published.setSurroundingAgent(previous);
  }
};

it.each([
  "Object.is(amount + 1, amount)",
  "Object.is(amount, amount)",
  "Object.is(amount, -amount)",
  "Object.is(amount, 0)",
  "Object.is(amount, -0)",
  "Object.is(amount, NaN)",
  "Object.is(amount, Infinity)",
  "Object.is(amount, -Infinity)",
  "Object.is(amount - amount, 0)",
  "Object.is(amount + 0, amount)",
  "Object.is(amount + NaN, NaN)",
  "Object.is((amount + 1) + 10, amount + (1 + 10))",
])("retains a SameValue predicate matching IEEE specializations: %s", async (source) => {
  await withAbstractFixture((fixture) => {
    const predicate = fixture.domain.getPredicate(getBoolean(fixture, source));
    expect(Object.isFrozen(predicate)).toBe(true);
    expect(JSON.parse(JSON.stringify(predicate))).toEqual(predicate);
    for (const amount of witnesses) {
      const actual = runInNewContext(
        getPredicateSource(predicate),
        { inputs: { amount } },
        { timeout: 1000 },
      );
      expect(actual).toBe(runInNewContext(source, { amount }, { timeout: 1000 }));
      expect(actual).toBe(getPublished(source, amount));
    }
  });
});

it.each(witnesses)("specializes two distinct unknown Numbers, left=%s", async (amount) => {
  await withAbstractFixture((fixture) => {
    fixture.api.X(
      fixture.api.CreateDataPropertyOrThrow(
        fixture.realm.GlobalObject,
        "other",
        fixture.domain.createInput("other"),
      ),
    );
    const predicate = fixture.domain.getPredicate(getBoolean(fixture, "Object.is(amount,other)"));
    for (const other of witnesses) {
      const actual = runInNewContext(
        getPredicateSource(predicate),
        { inputs: { amount, other } },
        { timeout: 1000 },
      );
      expect(actual).toBe(
        runInNewContext("Object.is(amount,other)", { amount, other }, { timeout: 1000 }),
      );
      expect(actual).toBe(getPublished("Object.is(amount,other)", amount, other));
    }
  });
});

it("uses intrinsic identity rather than the Object.is property name", async () => {
  await withAbstractFixture((fixture) => {
    fixture.evaluate(`
      var original = Object.is;
      Object.is = () => 17;
    `);
    expect(fixture.getNumber("Object.is(amount,0)").numberValue()).toBe(17);
    const predicate = getBoolean(fixture, "original(amount,0)");
    expect(fixture.api.BooleanValue.isAbstract(predicate)).toBe(true);
  });
});

it("preserves predicate identity for repeated operands, symmetry, NaN, and distinct signed zeros", async () => {
  await withAbstractFixture((fixture) => {
    const positive = getBoolean(fixture, "Object.is(amount, 0)");
    const negative = getBoolean(fixture, "Object.is(amount, -0)");
    expect(positive === negative).toBe(false);
    expect(getBoolean(fixture, "Object.is(0, amount)")).toBe(positive);
    expect(getBoolean(fixture, "Object.is(-0, amount)")).toBe(negative);
    const nan = getBoolean(fixture, "Object.is(amount, NaN)");
    expect(getBoolean(fixture, "Object.is(NaN, amount)")).toBe(nan);
    fixture.evaluate("var candidate=amount+1;");
    const predicate = getBoolean(fixture, "Object.is(candidate, amount)");
    expect(getBoolean(fixture, "Object.is(amount, candidate)")).toBe(predicate);
    expect(fixture.api.BooleanValue.isAbstract(predicate)).toBe(true);
    expect(Object.isFrozen(predicate)).toBe(true);
    expect(() => predicate.booleanValue()).toThrow("Unsupported concrete read of abstract Boolean");
    const expression = fixture.domain.getPredicate(predicate);
    if (expression.kind !== "same-value") throw new Error("Expected a SameValue predicate");
    expect(expression.right).toBe(
      fixture.domain.getExpression(fixture.domain.createInput("amount")),
    );
    expect(getBoolean(fixture, "Object.is(candidate, candidate)")).toBe(fixture.api.Value.true);
  });
});

it("keeps different-type comparisons concrete without coercing operands or calling the hook", async () => {
  await withAbstractFixture((fixture) => {
    fixture.agent.hostDefinedOptions.evaluateAbstractNumberPredicate = () => {
      throw new Error("Unexpected hook");
    };
    for (const source of [
      "Object.is(amount, undefined)",
      "Object.is(null, amount)",
      "Object.is(amount, true)",
      "Object.is(amount, '1')",
      "Object.is(1n, amount)",
      `Object.is(amount, {
          valueOf() {
            throw 1;
          },
        })`,
      "Object.is(Object(amount), amount)",
    ])
      expect(getBoolean(fixture, source)).toBe(fixture.api.Value.false);
    expect(getBoolean(fixture, "Object.is(NaN, NaN)")).toBe(fixture.api.Value.true);
    expect(getBoolean(fixture, "Object.is(0, -0)")).toBe(fixture.api.Value.false);
  });
});

it("retains argument evaluation order and immutable predicate callback records", async () => {
  await withAbstractFixture((fixture) => {
    const callback = fixture.domain.agentOptions.evaluateAbstractNumberPredicate;
    let calls = 0;
    fixture.agent.hostDefinedOptions.evaluateAbstractNumberPredicate = (predicate) => {
      expect(Object.isFrozen(predicate)).toBe(true);
      expect(Object.isFrozen(predicate.operands)).toBe(true);
      calls++;
      return callback(predicate);
    };
    getBoolean(
      fixture,
      `
        var order = "";
        Object.is(((order += "left"), amount), ((order += "right"), amount + 1))
      `,
    );
    expect(fixture.evaluate("order").Value).toEqual(fixture.api.Value("leftright"));
    expect(calls).toBe(1);
    expect(
      fixture.evaluate(`Object.is(
          (() => {
            throw 7;
          })(),
          amount
        )`).Type,
    ).toBe("throw");
    expect(calls).toBe(1);
  });
});

it.each(["missing", "invalid"])("rejects a %s numeric predicate callback", async (mode) => {
  await withAbstractFixture((fixture) => {
    if (mode === "missing") delete fixture.agent.hostDefinedOptions.evaluateAbstractNumberPredicate;
    else
      Reflect.set(fixture.agent.hostDefinedOptions, "evaluateAbstractNumberPredicate", () =>
        fixture.api.Value(1),
      );
    expect(() =>
      fixture.evaluate(`
        try {
          Object.is(amount, 0);
        } catch (error) {
          false;
        }
      `),
    ).toThrow(
      mode === "missing"
        ? "No abstract Number predicate evaluator configured"
        : "must return a Boolean",
    );
  });
});

it("does not put opaque results into host-Boolean comparison helpers", async () => {
  await withAbstractFixture((fixture) => {
    const input = fixture.domain.createInput("amount");
    expect(() => fixture.api.SameValue(input, input)).toThrow(
      "Unsupported concrete read of abstract Number",
    );
    expect(() => fixture.api.IsStrictlyEqual(input, input)).toThrow(
      "Unsupported concrete read of abstract Number",
    );
    expect(() =>
      fixture.evaluate(`
        if (!Object.is(amount + 1, amount)) 1;
        else 2;
      `),
    ).toThrow("requires an explicit resume");
  });
});

it("rejects foreign operands and predicate values", async () => {
  const domain = await createNumericDomain();
  const other = await createNumericDomain();
  const { api } = await getSymbolicEngine();
  const input = domain.createInput("amount");
  expect(() =>
    domain.agentOptions.evaluateAbstractNumberPredicate({
      operator: "sameValue",
      operands: [input, other.createInput("amount")],
    }),
  ).toThrow("another numeric domain");
  const foreign = other.agentOptions.evaluateAbstractNumberPredicate({
    operator: "sameValue",
    operands: [other.createInput("amount"), api.Value(0)],
  });
  expect(() => domain.getPredicate(foreign)).toThrow("another numeric domain");
  expect(() => Reflect.apply(domain.getPredicate, undefined, [api.Value(1)])).toThrow(
    "Expected an engine Boolean",
  );
  expect(domain.getPredicate(api.Value.true)).toEqual({ kind: "constant", value: true });
  expect(domain.getPredicate(api.Value.false)).toEqual({ kind: "constant", value: false });
});

it("validates predicate operation shape, operand type, and abstract provenance", async () => {
  const domain = await createNumericDomain();
  const { api } = await getSymbolicEngine();
  const input = domain.createInput("amount");
  const callback = domain.agentOptions.evaluateAbstractNumberPredicate;
  expect(() => callback({ operator: "sameValue", operands: [api.Value(0), api.Value(1)] })).toThrow(
    "Expected an abstract numeric operand",
  );
  expect(() => callback({ operator: "sameValue", operands: [input] })).toThrow(
    "Unsupported abstract numeric predicate",
  );
  expect(() =>
    Reflect.apply(callback, undefined, [{ operator: "lessThan", operands: [input, api.Value(0)] }]),
  ).toThrow("Unsupported abstract numeric predicate");
  expect(() =>
    Reflect.apply(callback, undefined, [
      { operator: "sameValue", operands: [input, api.Value.true] },
    ]),
  ).toThrow("Expected an engine Number");
});

it.each([0, -1, 1.5, NaN, Infinity])(
  "rejects an invalid predicate budget: %s",
  async (maxPredicates) => {
    await expect(createNumericDomain({ maxPredicates })).rejects.toThrow("positive safe integers");
  },
);

it("snapshots the predicate budget and lets cached/reflexive/concrete results survive exhaustion", async () => {
  const options = { maxPredicates: 1 };
  const pending = createNumericDomain(options);
  options.maxPredicates = 100;
  const domain = await pending;
  await withAbstractFixture((fixture) => {
    const predicate = getBoolean(fixture, "Object.is(amount, 0)");
    expect(getBoolean(fixture, "Object.is(0,amount)")).toBe(predicate);
    expect(getBoolean(fixture, "Object.is(amount,amount)")).toBe(fixture.api.Value.true);
    expect(getBoolean(fixture, "Object.is(NaN,NaN)")).toBe(fixture.api.Value.true);
    expect(() => fixture.evaluate("Object.is(amount,-0)")).toThrow("predicate budget exceeded");
  }, domain);
});

it.each([false, true])(
  "forks a SameValue state bailout with selected state and one prefix, reversed=%s",
  async (isReversed) => {
    const observations: GuardedState[] = [];
    let prefixVisits = 0;
    const domain = await createNumericDomain({ maxPredicates: 1 });
    await withAbstractFixture((fixture) => {
      const { api, agent, realm } = fixture;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixVisits++;
      };
      const iterator = fixture.compile(bailoutSource);
      let step = iterator.next();
      while (!step.done && step.value.suspend !== "abstract-boolean") {
        if (step.value.suspend !== "debugger" && step.value.suspend !== "potential-debugger")
          throw new Error("Unexpected suspension");
        step = iterator.next({ resume: "debugger", value: undefined });
      }
      if (step.done || step.value.suspend !== "abstract-boolean")
        throw new Error("Expected a predicate decision");
      const decision = step.value;
      const guard = domain.getPredicate(decision.value);
      const shared = fixture.evaluate("state").Value;
      if (
        !api.isOrdinaryObject(shared) ||
        !(realm.GlobalEnv instanceof api.GlobalEnvironmentRecord)
      )
        throw new Error("Expected selected state");
      const contexts = [...agent.executionContextStack];
      const state = api.createStateCheckpoint({
        objects: [shared],
        environments: [realm.GlobalEnv.DeclarativeRecord],
      });
      try {
        const checkpoint = api.captureControl(iterator, {
          capture: () => ({
            restore: () => {
              state.restore();
              agent.executionContextStack.splice(
                0,
                agent.executionContextStack.length,
                ...contexts,
              );
            },
          }),
        });
        for (const choice of isReversed ? [true, false] : [false, true]) {
          checkpoint.restore();
          let resumed = iterator.next({ resume: "abstract-boolean", decision, value: choice });
          let repeated = 0;
          while (!resumed.done) {
            if (resumed.value.suspend === "abstract-boolean") {
              expect(resumed.value.value).toBe(decision.value);
              repeated++;
              resumed = iterator.next({
                resume: "abstract-boolean",
                decision: resumed.value,
                value: choice,
              });
            } else {
              if (
                resumed.value.suspend !== "debugger" &&
                resumed.value.suspend !== "potential-debugger"
              )
                throw new Error("Unexpected suspension");
              resumed = iterator.next({ resume: "debugger", value: undefined });
            }
          }
          expect(api.EnsureCompletion(resumed.value).Type).toBe("normal");
          expect(repeated).toBe(1);
          const tag = fixture.evaluate("state.tag").Value;
          if (!(tag instanceof api.JSStringValue)) throw new Error("Expected state tag");
          observations.push({
            choice,
            guard,
            tag: tag.stringValue(),
            value: domain.getExpression(fixture.getNumber("state.value")),
          });
        }
      } finally {
        state.release();
      }
    }, domain);
    expect(prefixVisits).toBe(1);
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      let matches = 0;
      for (const amount of witnesses) {
        const choice = runInNewContext(
          getPredicateSource(observation.guard),
          { inputs: { amount } },
          { timeout: 1000 },
        );
        if (choice !== observation.choice) continue;
        matches++;
        const expectedSame = getPublished("Object.is(amount+1,amount)", amount);
        expect(choice).toBe(expectedSame);
        expect(observation.tag).toBe(expectedSame ? "bailout" : "update");
        const value = runInNewContext(
          getExpressionSource(observation.value),
          { inputs: { amount } },
          { timeout: 1000 },
        );
        expect(Object.is(value, expectedSame ? amount : amount + 1)).toBe(true);
        if (typeof value !== "number") throw new Error("Expected a specialized Number");
        const valueSource = getNumberSource(value);
        const comparison = `
          ${bailoutSource};
          prefix === 1 &&
            state.tag === ${JSON.stringify(observation.tag)} &&
            Object.is(state.value, ${valueSource})
        `;
        expect(runInNewContext(comparison, { amount }, { timeout: 1000 })).toBe(true);
        expect(getPublished(comparison, amount)).toBe(true);
      }
      expect(matches).toBeGreaterThan(0);
    }
  },
);
