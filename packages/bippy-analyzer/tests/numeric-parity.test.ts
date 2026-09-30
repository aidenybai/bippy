import * as published from "@engine262/engine262";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  createNumericDomain,
  createBooleanSnapshotExplorer,
  specializeGuardedHostTree,
} from "../src/index.js";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { getExpressionSource, getPredicateSource } from "./helpers/numeric-expression.js";

it.each([false, true])(
  "forks an interned parity predicate without prefix replay, trueFirst=%s",
  async (trueFirst) => {
    const explorer = await createBooleanSnapshotExplorer();
    const domain = await createNumericDomain({ maxOperations: 3, maxPredicates: 1 });
    await withAbstractFixture(({ api, agent, realm, compile }) => {
      const source = `var prefix = 0; prefix++; var remainder = amount % 2; var even = remainder === 0; var label; if (even) label = 'even'; else label = 'odd'; if (amount % 2 !== -0) label += '!'; JSON.stringify({type:'output',props:{prefix},children:[label]});`;
      let prefixes = 0,
        captures = 0,
        releases = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
      };
      agent.evaluate(compile(source), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
      if (pause.done || !pause.value) throw new Error("Expected parity decision");
      const predicate = domain.getPredicate(pause.value.value);
      expect(predicate.kind).toBe("strict-equal");
      const report = explorer.explore({
        agent,
        trueFirst,
        inputs: [{ name: "even", value: pause.value.value }],
        createOwner: () => {
          const contexts = [...agent.executionContextStack];
          let storage: StateCheckpoint | undefined;
          return {
            capture: () => {
              captures++;
              storage = api.createStateCheckpoint({
                objects: [realm.GlobalObject],
                environments: [realm.GlobalEnv],
              });
              return {
                restore: () => {
                  storage?.restore();
                  agent.executionContextStack.splice(
                    0,
                    agent.executionContextStack.length,
                    ...contexts,
                  );
                },
              };
            },
            release: () => {
              storage?.release();
              releases++;
            },
          };
        },
        observe: (completion) => {
          if (completion.Type !== "normal" || !(completion.Value instanceof api.JSStringValue))
            throw new Error("Expected snapshot");
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          return { kind: "commit", snapshot: completion.Value.stringValue() };
        },
      });
      expect([prefixes, captures, releases]).toEqual([1, 1, 1]);
      expect(report.observations).toHaveLength(2);
      expect(report.execution).toBe("not-verified");
      for (const amount of witnesses) {
        const even = runInNewContext(getPredicateSource(predicate), { inputs: { amount } });
        const selected = specializeGuardedHostTree(report, new Map([["even", even]]));
        if (selected.kind !== "selected" || selected.outcome.kind !== "commit")
          throw new Error("Expected selected snapshot");
        expect(JSON.parse(selected.outcome.snapshot)).toEqual(
          JSON.parse(runInNewContext(source, { amount })),
        );
      }
    }, domain);
  },
);

it("interns exact ordered terms without skipping coercions or merging signed zeros and association", async () => {
  await withAbstractFixture(({ domain, getNumber, evaluate }) => {
    const getTerm = (source: string) => domain.getExpression(getNumber(source));
    expect(getTerm("amount % 2")).toBe(getTerm("amount % 2"));
    expect(getTerm("(amount + 1) % 2")).toBe(getTerm("(amount + 1) % 2"));
    expect(getTerm("-amount")).toBe(getTerm("-amount"));
    expect(getTerm("amount + 0") === getTerm("amount + -0")).toBe(false);
    expect(getTerm("amount % 2") === getTerm("2 % amount")).toBe(false);
    expect(getTerm("(amount + 1) + 10") === getTerm("amount + (1 + 10)")).toBe(false);
    evaluate("var calls = 0; var divisor = {valueOf(){calls++; return 2;}};");
    expect(getTerm("amount % divisor")).toBe(getTerm("amount % divisor"));
    expect(getNumber("calls").numberValue()).toBe(2);
  });
});

const witnesses = [
  NaN,
  Infinity,
  -Infinity,
  0,
  -0,
  1,
  -1,
  2,
  -2,
  5,
  -5,
  0.5,
  -0.5,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.EPSILON,
  Number.MAX_SAFE_INTEGER,
  2 ** 53,
];

it.each(witnesses)(
  "specializes two unknown Numbers against published numeric operators, amount=%s",
  async (amount) => {
    await withAbstractFixture(({ api, domain, realm, getNumber, evaluate }) => {
      api.X(
        api.CreateDataPropertyOrThrow(realm.GlobalObject, "other", domain.createInput("other")),
      );
      const expression = domain.getExpression(getNumber("amount % other"));
      const equality = evaluate("amount === other");
      if (!(equality.Value instanceof api.BooleanValue)) throw new Error("Expected Boolean");
      const predicate = domain.getPredicate(equality.Value);
      for (const other of witnesses) {
        const number = runInNewContext(getExpressionSource(expression), {
          inputs: { amount, other },
        });
        const expected = published.NumberValue.remainder(
          published.Value(amount),
          published.Value(other),
        ).numberValue();
        expect(Object.is(number, expected)).toBe(true);
        expect(Object.is(number, amount % other)).toBe(true);
        const equal = runInNewContext(getPredicateSource(predicate), { inputs: { amount, other } });
        expect(equal).toBe(
          published.NumberValue.equal(published.Value(amount), published.Value(other)),
        );
        expect(equal).toBe(amount === other);
      }
    });
  },
);

it.each([
  "amount % 2",
  "2 % amount",
  "amount % amount",
  "amount % 0",
  "amount % -0",
  "amount % Infinity",
  "amount % NaN",
  "(amount + 1) % 2",
  "amount % '2'",
  "amount % null",
])("retains exact remainder terms: %s", async (source) => {
  await withAbstractFixture(({ domain, getNumber }) => {
    const expression = domain.getExpression(getNumber(source));
    expect(Object.isFrozen(expression)).toBe(true);
    expect(JSON.parse(JSON.stringify(expression))).toEqual(expression);
    for (const amount of witnesses) {
      expect(
        Object.is(
          runInNewContext(getExpressionSource(expression), { inputs: { amount } }),
          runInNewContext(source, { amount }),
        ),
      ).toBe(true);
    }
  });
});

it.each([
  "amount === amount",
  "amount === 0",
  "amount === -0",
  "amount === NaN",
  "amount === Infinity",
  "amount % 2 === 0",
  "amount % 2 === -0",
  "(amount + 1) % 2 === 0",
])("retains strict equality including NaN and signed zero: %s", async (source) => {
  await withAbstractFixture(({ api, domain, evaluate }) => {
    const result = evaluate(source);
    if (!(result.Value instanceof api.BooleanValue)) throw new Error("Expected Boolean");
    const predicate = domain.getPredicate(result.Value);
    expect(Object.isFrozen(predicate)).toBe(true);
    expect(JSON.parse(JSON.stringify(predicate))).toEqual(predicate);
    for (const amount of witnesses)
      expect(runInNewContext(getPredicateSource(predicate), { inputs: { amount } })).toBe(
        runInNewContext(source, { amount }),
      );
  });
});

it("separates equality from SameValue and shares opposite zero/symmetric equality predicates", async () => {
  await withAbstractFixture(({ api, domain, evaluate }) => {
    const getBoolean = (source: string) => {
      const result = evaluate(source);
      if (!(result.Value instanceof api.BooleanValue)) throw new Error("Expected Boolean");
      return result.Value;
    };
    const equal = getBoolean("amount === 0");
    expect(getBoolean("0 === amount")).toBe(equal);
    expect(getBoolean("amount === -0")).toBe(equal);
    expect(getBoolean("Object.is(amount, 0)") === equal).toBe(false);
    expect(getBoolean("Object.is(amount, -0)") === getBoolean("Object.is(amount, 0)")).toBe(false);
    const self = getBoolean("amount === amount");
    expect(api.BooleanValue.isAbstract(self)).toBe(true);
    expect(getBoolean("Object.is(amount, amount)")).toBe(api.Value.true);
    expect(getBoolean("amount === NaN")).toBe(api.Value.false);
    expect(domain.scope).toBe("engine262-number-expression-domain-v2");
  });
});

it.each(["'0'", "1n", "null", "undefined", "({valueOf(){throw 1}})", "Symbol()"])(
  "keeps mixed-type strict equality concrete without coercion: %s",
  async (operand) => {
    await withAbstractFixture(({ api, evaluate }) => {
      expect(evaluate(`amount === ${operand}`).Value).toBe(api.Value.false);
      expect(evaluate(`amount !== ${operand}`).Value).toBe(api.Value.true);
    });
  },
);

it("keeps remainder coercion order and mixed-BigInt failures in original engine algorithms", async () => {
  await withAbstractFixture(({ api, domain, evaluate, getNumber }) => {
    evaluate(
      `var log = []; var left = {valueOf(){log.push('left'); return amount;}}; var right = {valueOf(){log.push('right'); return 2;}};`,
    );
    expect(domain.getExpression(getNumber("left % right"))).toEqual({
      kind: "operation",
      operator: "remainder",
      operands: [
        { kind: "input", name: "amount" },
        { kind: "constant", value: "2" },
      ],
    });
    expect(evaluate("JSON.stringify(log)").Value).toEqual(api.Value('["left","right"]'));
    expect(evaluate("amount % 1n")).toBeInstanceOf(api.ThrowCompletion);
    expect(evaluate("1n % amount")).toBeInstanceOf(api.ThrowCompletion);
    expect(evaluate("try { amount % 1n; } catch(error) { error.name; }").Value).toEqual(
      api.Value("TypeError"),
    );
  });
});

it("keeps remainder and predicate budgets global and validates foreign operands before constant folding", async () => {
  const domain = await createNumericDomain({ maxOperations: 1, maxPredicates: 1 });
  const other = await createNumericDomain();
  await withAbstractFixture(({ api, evaluate, getNumber }) => {
    getNumber("amount % 2");
    evaluate("amount === 0");
    expect(() => evaluate("amount === -0")).not.toThrow();
    expect(() =>
      domain.agentOptions.evaluateAbstractNumberPredicate({
        operator: "sameValue",
        operands: [domain.createInput("amount"), api.Value(0)],
      }),
    ).toThrow("predicate budget exceeded");
    expect(() =>
      domain.agentOptions.evaluateAbstractNumberPredicate({
        operator: "equal",
        operands: [other.createInput("other"), api.Value(NaN)],
      }),
    ).toThrow("another numeric domain");
    expect(() => getNumber("amount % 2")).toThrow("operation budget exceeded");
  }, domain);
});

it.each([false, true])("reuses one predicate through === and !==, equal=%s", async (choice) => {
  await withAbstractFixture(({ api, agent, realm, compile, domain }) => {
    let prefixes = 0,
      decisions = 0;
    const predicates: object[] = [];
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
    };
    agent.evaluate(
      compile(
        `var prefix = 0; prefix++; var remainder = amount % 2; var even = remainder === 0; var opposite = remainder !== -0; if (even) { if (opposite) throw 'inconsistent'; } else { if (!opposite) throw 'inconsistent'; } JSON.stringify([even ? 'even' : 'odd', opposite, prefix]);`,
      ),
      () => {},
      false,
    );
    let step = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
    while (!step.done) {
      if (!step.value || ++decisions > 8) throw new Error("Unexpected decision");
      predicates.push(domain.getPredicate(step.value.value));
      step = agent.resumeEvaluate({
        abstractBooleanDecision: {
          resume: "abstract-boolean",
          decision: step.value,
          value: choice,
        },
        noBreakpoint: true,
      });
    }
    expect(decisions).toBeGreaterThan(1);
    expect(predicates.every((predicate) => predicate === predicates[0])).toBe(true);
    expect(prefixes).toBe(1);
    const result = api.EnsureCompletion(step.value);
    expect(result.Value).toEqual(api.Value(JSON.stringify([choice ? "even" : "odd", !choice, 1])));
    expect(realm.GlobalObject.properties.get("remainder")?.Value).toBeInstanceOf(api.NumberValue);
  });
});
