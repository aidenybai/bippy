import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { createNumericDomain } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { withAbstractFixture as withNumericFixture } from "./helpers/abstract-fixture.js";
import { getExpressionSource } from "./helpers/numeric-expression.js";

const witnesses = [
  NaN,
  Infinity,
  -Infinity,
  0,
  -0,
  1,
  -1,
  0.1,
  -0.1,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.EPSILON,
  -Number.EPSILON,
  Number.MAX_SAFE_INTEGER,
  -Number.MAX_SAFE_INTEGER,
  2 ** 53,
  -(2 ** 53),
  2 ** 31,
  -(2 ** 31),
  1e-200,
  -1e-200,
];

it.each([
  "amount + 1",
  "amount - '2'",
  "amount + true",
  "amount - null",
  "({ valueOf(){ return amount; } }) + 1",
  "(amount + 1) + 10",
  "amount + (1 + 10)",
  "amount - 1",
  "1 - amount",
  "-amount",
  "-(-amount)",
  "amount - amount",
  "amount + (-0)",
  "amount + Infinity",
  "amount - Infinity",
  "amount + NaN",
  "(amount - 1) + amount",
])("retains an unbounded term matching native specializations: %s", async (source) => {
  await withNumericFixture(({ domain, getNumber }) => {
    const expression = domain.getExpression(getNumber(source));
    const specialized = getExpressionSource(expression);
    expect(JSON.parse(JSON.stringify(expression))).toEqual(expression);
    for (const amount of witnesses) {
      const expected: unknown = runInNewContext(source, { amount }, { timeout: 1000 });
      const actual: unknown = runInNewContext(
        specialized,
        { inputs: { amount } },
        { timeout: 1000 },
      );
      expect(Object.is(actual, expected)).toBe(true);
    }
  });
});

it("preserves association instead of simplifying IEEE Number expressions", async () => {
  await withNumericFixture(({ domain, getNumber }) => {
    expect(domain.getExpression(getNumber("(amount + 1) + 10"))).toEqual({
      kind: "operation",
      operator: "add",
      operands: [
        {
          kind: "operation",
          operator: "add",
          operands: [
            { kind: "input", name: "amount" },
            { kind: "constant", value: "1" },
          ],
        },
        { kind: "constant", value: "10" },
      ],
    });
    expect(domain.getExpression(getNumber("amount - amount")).kind).toBe("operation");
  });
});

it("runs actual engine calls, mutation, throw, and finally with an unknown amount", async () => {
  await withNumericFixture(({ api, domain, evaluate, getNumber }) => {
    evaluate(`var shared={count:amount},alias=shared,prefix=0,caught;
      function update(){prefix++;shared.count=shared.count+1;throw shared.count;}
      try{update();}catch(error){caught=error;}finally{shared.count=shared.count+10;}`);
    expect(evaluate("alias === shared").Value).toBe(api.Value.true);
    expect(getNumber("prefix").numberValue()).toBe(1);
    expect(getExpressionSource(domain.getExpression(getNumber("caught")))).toBe(
      '((inputs["amount"])+(1))',
    );
    expect(getExpressionSource(domain.getExpression(getNumber("shared.count")))).toBe(
      '((((inputs["amount"])+(1)))+(10))',
    );
  });
});

it("preserves an abstract thrown value as an engine abrupt completion", async () => {
  await withNumericFixture(({ api, domain, evaluate }) => {
    const completion = evaluate("throw amount + 1");
    if (
      !(completion instanceof api.ThrowCompletion) ||
      !(completion.Value instanceof api.NumberValue)
    )
      throw new Error("Expected an abstract numeric throw");
    expect(getExpressionSource(domain.getExpression(completion.Value))).toBe(
      '((inputs["amount"])+(1))',
    );
  });
});

it("keeps input identity, immutable terms, and Number type without a concrete value", async () => {
  await withNumericFixture(({ api, domain, evaluate, getNumber }) => {
    const input = domain.createInput("amount");
    expect(domain.createInput("amount")).toBe(input);
    expect(api.NumberValue.isAbstract(input)).toBe(true);
    expect(Object.isFrozen(input)).toBe(true);
    expect(() => input.numberValue()).toThrow("Unsupported concrete read of abstract Number");
    expect(() => input.value).toThrow("Unsupported concrete read of abstract Number");
    expect(() => JSON.stringify(input)).toThrow("Unsupported concrete read of abstract Number");
    expect(evaluate("typeof amount").Value).toEqual(api.Value("number"));
    expect(getNumber("+amount")).toBe(input);
    expect(getNumber("Object(amount).valueOf()")).toBe(input);
    const expression = domain.getExpression(getNumber("amount + 1"));
    expect(Object.isFrozen(expression)).toBe(true);
    if (expression.kind !== "operation") throw new Error("Expected an operation");
    expect(Object.isFrozen(expression.operands)).toBe(true);
    expect(expression.operands.every(Object.isFrozen)).toBe(true);
    const shared = domain.getExpression(getNumber("var doubled=amount+1;doubled+doubled"));
    if (shared.kind !== "operation") throw new Error("Expected an operation");
    expect(shared.operands[0]).toBe(shared.operands[1]);
  });
});

it.each([
  "amount * 2",
  "amount / 2",
  "amount % 2",
  "amount ** 2",
  "amount & 1",
  "amount === amount",
  "new Set([amount]).has(amount)",
  "amount < 0",
  "Boolean(amount)",
  "String(amount)",
  "if(amount) 1; else 2;",
  "Math.abs(amount)",
  "JSON.stringify(amount)",
])("rejects unsupported concrete reads: %s", async (source) => {
  await withNumericFixture(({ evaluate }) => {
    expect(() => evaluate(source)).toThrow("Unsupported concrete read of abstract Number");
  });
});

it("does not turn unsupported abstraction into a catchable guest exception", async () => {
  await withNumericFixture(({ evaluate }) => {
    expect(() => evaluate("try { amount * 2; } catch(error) { 17; }")).toThrow(
      "Unsupported concrete read of abstract Number",
    );
  });
});

it("uses engine update and assignment semantics without changing the input identity", async () => {
  await withNumericFixture(({ domain, evaluate, getNumber }) => {
    evaluate("var first=amount++;amount-=2;var read=()=>amount;");
    expect(getNumber("first")).toBe(domain.createInput("amount"));
    expect(getExpressionSource(domain.getExpression(getNumber("read()")))).toBe(
      '((((inputs["amount"])+(1)))-(2))',
    );
  });
});

it("supplies immutable operation records only for abstract operands", async () => {
  await withNumericFixture(({ api, domain, getNumber }) => {
    const evaluator = domain.agentOptions.evaluateAbstractNumber;
    const operators: string[] = [];
    api.surroundingAgent.hostDefinedOptions.evaluateAbstractNumber = (operation) => {
      expect(Object.isFrozen(operation)).toBe(true);
      expect(Object.isFrozen(operation.operands)).toBe(true);
      operators.push(operation.operator);
      return evaluator(operation);
    };
    getNumber("1 + 2 - 3");
    expect(operators).toEqual([]);
    getNumber("-(amount + 1) - 2");
    expect(operators).toEqual(["add", "unaryMinus", "subtract"]);
  });
});

it("rejects a host handler that returns a non-Number", async () => {
  await withNumericFixture(({ api, evaluate }) => {
    Reflect.set(api.surroundingAgent.hostDefinedOptions, "evaluateAbstractNumber", () =>
      api.Value("invalid"),
    );
    expect(() => evaluate("amount + 1")).toThrow("must return a Number");
  });
});

it("preserves engine coercion order and mixed-BigInt rejection", async () => {
  await withNumericFixture(({ api, domain, evaluate, getNumber }) => {
    evaluate("var calls=0;var operand={valueOf(){calls++;return 2;}};");
    expect(getExpressionSource(domain.getExpression(getNumber("amount + operand")))).toBe(
      '((inputs["amount"])+(2))',
    );
    expect(getNumber("calls").numberValue()).toBe(1);
    const completion = evaluate("amount + 1n");
    expect(completion).toBeInstanceOf(api.ThrowCompletion);
  });
});

it("rejects foreign abstract numbers and preserves concrete constants", async () => {
  const domain = await createNumericDomain();
  const other = await createNumericDomain();
  const { api } = await getSymbolicEngine();
  expect(() => domain.getExpression(other.createInput("amount"))).toThrow("another numeric domain");
  for (const number of [NaN, Infinity, -Infinity, -0, 0, Number.MIN_VALUE]) {
    expect(domain.getExpression(api.Value(number))).toEqual({
      kind: "constant",
      value: Object.is(number, -0) ? "-0" : String(number),
    });
  }
  expect(() =>
    domain.agentOptions.evaluateAbstractNumber({
      operator: "add",
      operands: [domain.createInput("amount"), other.createInput("amount")],
    }),
  ).toThrow("another numeric domain");
});

it("snapshots budgets and keeps concrete arithmetic outside the operation budget", async () => {
  const options = { maxInputs: 1, maxOperations: 1 };
  const pending = createNumericDomain(options);
  options.maxInputs = 10;
  options.maxOperations = 10;
  const domain = await pending;
  await withNumericFixture(({ getNumber }) => {
    expect(() => domain.createInput("other")).toThrow("Numeric input budget exceeded");
    expect(domain.createInput("amount")).toBe(domain.createInput("amount"));
    expect(getNumber("1 + 2").numberValue()).toBe(3);
    getNumber("amount + 1");
    expect(() => getNumber("amount - 1")).toThrow("operation budget exceeded");
    expect(domain.getExpression(domain.createInput("amount"))).toEqual({
      kind: "input",
      name: "amount",
    });
  }, domain);
});

it.each([0, -1, NaN, Infinity, 0.5])("rejects invalid numeric budgets: %s", async (budget) => {
  await expect(createNumericDomain({ maxInputs: budget })).rejects.toThrow(
    "positive safe integers",
  );
  await expect(createNumericDomain({ maxOperations: budget })).rejects.toThrow(
    "positive safe integers",
  );
});

it("preserves concrete field definition before constructor assignment", async () => {
  const { api } = await getSymbolicEngine();
  const prototype = api.NumberValue.prototype;
  const previous = Object.getOwnPropertyDescriptor(prototype, "value");
  Object.defineProperty(prototype, "value", {
    configurable: true,
    set: () => {
      throw new Error("Inherited value setter must not run");
    },
  });
  try {
    expect(api.Value(7).numberValue()).toBe(7);
  } finally {
    if (previous) Object.defineProperty(prototype, "value", previous);
    else Reflect.deleteProperty(prototype, "value");
  }
});

it("rejects invalid names and requires an engine numeric handler", async () => {
  const domain = await createNumericDomain();
  expect(() => domain.createInput("")).toThrow("1 to 128");
  expect(() => domain.createInput("name".repeat(33))).toThrow("1 to 128");
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
  try {
    expect(() => api.NumberValue.add(domain.createInput("amount"), api.Value(1))).toThrow(
      "No abstract Number evaluator configured",
    );
    expect(api.NumberValue.add(api.Value(1), api.Value(2)).numberValue()).toBe(3);
  } finally {
    api.setSurroundingAgent(previous);
  }
});
