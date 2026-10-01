import { expect, it } from "vite-plus/test";
import { compileFunction } from "../src/compiler/compile-function.js";
import { getErrorWitness } from "../src/evaluate/errors.js";
import { branchValue, objectFromRecord, primitiveValue } from "../src/evaluate/values.js";
import {
  createSsaExecution,
  parseSsaFunction,
  checkSsaAgainstNative,
  getNativeScalarOutcome,
  getSsaScalarOutcome,
} from "./helpers/ssa-evaluator.js";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

it.each([
  "function probe(first) { return first.name; }",
  "function probe(first) { return first + 1; }",
  "function probe(first) { if(first) return 1; return 2; }",
])("rejects object parameters without touching them: %s", (source) => {
  const first = objectFromRecord({ name: primitiveValue("unchanged") });
  const execution = createSsaExecution(source, { first }, 1000);
  const before = [...execution.context.scope.bindings];
  expect(execution.execute()).toBeNull();
  expect(execution.context.budget.remaining).toBe(1000);
  expect([...execution.context.scope.bindings]).toEqual(before);
  expect(getErrorWitness(first)).toBeNull();
});

it.each([
  "return first.name;",
  "let value=0; for(let index=0;index<20;index++) value++; return first.message;",
  "try { throw first; } catch(error) { return error.name; }",
])("restores budget and bindings after late deoptimization: %s", (body) => {
  const execution = createSsaExecution(
    `function probe(first){${body}}`,
    { first: primitiveValue("text") },
    1000,
  );
  let steps = 0;
  const before = [...execution.context.scope.bindings];
  expect(
    execution.execute({
      consumeStep: () => {
        steps++;
        return --execution.context.budget.remaining >= 0;
      },
    }),
  ).toBeNull();
  expect(steps).toBeGreaterThan(0);
  expect(execution.context.budget.remaining).toBe(1000);
  expect([...execution.context.scope.bindings]).toEqual(before);
});

it.each([
  "function probe(){ external(); return 1; }",
  "function probe(){ external.value=1; return 2; }",
  "function probe(){ const callback=()=>1;return callback(); }",
  "function probe(){ let value=1; const read=()=>value;value=2;return read(); }",
  "function probe(){ return [1,2]; }",
  "function probe(){ return {value:1}; }",
  "function probe(){ return `value:${1}`; }",
  "function probe(){ return this; }",
  "function probe(){ return 1 in 2; }",
  "function probe(first=1){return first;}",
  "function probe({value}){return value;}",
  "function probe(...values){return values;}",
  "async function probe(){return 1;}",
  "function* probe(){yield 1;return 2;}",
  "function probe(){return typeof missing;}",
])("declines unsupported execution before consuming steps: %s", (source) => {
  const execution = createSsaExecution(source, {}, 1000);
  expect(execution.execute()).toBeNull();
  expect(execution.context.budget.remaining).toBe(1000);
});

it.each([
  "if(false) external(); return 7;",
  "if(true) return 7; return external();",
  "const receiver=null; receiver?.[external()]; return 7;",
  "const callback=null; callback?.(external()); return 7;",
  "false && external(); return 7;",
  "true || external(); return 7;",
  "0 ?? external(); return 7;",
  "if(false) 1 in 2; return 7;",
  "if(false) 1 instanceof 2; return 7;",
])("does not deopt for statically dead effects: %s", (body) => checkSsaAgainstNative(body));

it.each(
  ["in", "instanceof"].flatMap((operator) =>
    ["0", "null", "void 0", "true", "'text'"].map((right) => ({ operator, right })),
  ),
)("fallback retains native invalid RHS errors: $operator/$right", ({ operator, right }) =>
  checkDifferentialCases([
    {
      name: "SSA operator fallback",
      body: `const probe=()=>1 ${operator} (${right}); try { return probe(); } catch(error) { return error.name; }`,
    },
  ]),
);

it.each([0, 1, null, undefined, false, true, "text", 1n])(
  "throws for primitive instanceof RHS: %s",
  (second) => {
    checkSsaAgainstNative("return first instanceof second;", { first: 7, second });
    checkSsaAgainstNative(
      "try { return first instanceof second; } catch(error) { return error.message; }",
      { first: 7, second },
    );
  },
);

it.each([0, 1, 2, 5, 20])("enforces a step budget of %i without restarting AST work", (budget) => {
  const execution = createSsaExecution(
    "function probe(){let total=0;for(let index=0;index<100;index++)total++;return total;}",
    {},
    budget,
  );
  const result = execution.execute();
  expect(result?.kind).toBe("unknown");
  if (result?.kind !== "unknown") throw new Error("Expected budget exhaustion");
  expect(result.reason).toBe("step budget exhausted");
  expect(execution.context.budget.remaining).toBeLessThan(0);
});

it.each(["for(;;){}", "while(true){}", "do{}while(true);"])(
  "bounds nonterminating control flow: %s",
  (body) => {
    const execution = createSsaExecution(`function probe(){${body}}`, {}, 100000);
    const result = execution.execute();
    expect(result?.kind).toBe("unknown");
    if (result?.kind !== "unknown") throw new Error("Expected bounded uncertainty");
    expect(result.reason).toBe("SSA loop iteration limit exceeded");
    expect(execution.context.budget.remaining).toBeGreaterThan(0);
  },
);

it("routes mixed arithmetic completions through separate continuations", () => {
  const body =
    "let trace='start:'; try { const value=first+1; trace+='normal:'; return trace+value; } catch(error) { trace+='caught:'; return trace+error.name; }";
  const first = branchValue([primitiveValue(1n), primitiveValue(1)], "mixed numeric input");
  const execution = createSsaExecution(`function probe(first){${body}}`, { first });
  let distributions = 0;
  const result = execution.execute({
    distribute: (value, run) => {
      distributions++;
      if (value.kind !== "branch") throw new Error("Expected mixed completion");
      return branchValue(value.alternatives.map(run), "distributed completion");
    },
  });
  expect(distributions).toBe(1);
  expect(result?.kind).toBe("branch");
  if (result?.kind !== "branch") throw new Error("Expected separate completions");
  expect(result.alternatives.map(getSsaScalarOutcome)).toEqual(
    [1n, 1].map((input) => getNativeScalarOutcome(body, { first: input })),
  );
});

it("does not swallow host failures as deoptimization", () => {
  const execution = createSsaExecution("function probe(first){return typeof first;}", {
    first: primitiveValue(3),
  });
  const failure = new Error("host failed");
  expect(() =>
    execution.execute({
      getTypeof: () => {
        throw failure;
      },
    }),
  ).toThrow(failure);
});

it("reuses compilation without retaining argument values", () => {
  const execution = createSsaExecution(
    "function probe(first){let value=first;for(let index=0;index<3;index++)value++;return value;}",
    { first: primitiveValue(1) },
  );
  const compiled = compileFunction(execution.node);
  for (const initial of [1, 7, -9, 100, 0]) {
    execution.context.scope.bindings.set("first", primitiveValue(initial));
    expect(execution.execute()).toEqual(primitiveValue(initial + 3));
    expect(compileFunction(execution.node)).toBe(compiled);
  }
});

it.each([
  { name: "dynamic eval", source: "function probe(code){eval(code);return 1;}" },
  { name: "node budget", source: `function probe(){${"0;".repeat(16000)}}` },
  {
    name: "binding depth",
    source: `function probe(){${"{".repeat(270)}return 1;${"}".repeat(270)}}`,
  },
  { name: "block budget", source: `function probe(first){${"if(first){}".repeat(1500)}return 1;}` },
  {
    name: "instruction budget",
    source: `function probe(first){try{${Array.from({ length: 20 }, (_, index) => `if(first===${index})return ${index};`).join("")}}finally{${"0;".repeat(1600)}}}`,
  },
])("caches an explicit unsupported result: $name", ({ source }) => {
  const node = parseSsaFunction(source);
  const result = compileFunction(node);
  expect(result.status).toBe("unsupported");
  expect(result.function).toBeNull();
  expect(result.reason).toBeTruthy();
  expect(compileFunction(node)).toBe(result);
});
