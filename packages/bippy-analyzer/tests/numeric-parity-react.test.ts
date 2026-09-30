import { runInNewContext } from "node:vm";
import { beforeAll, expect, it } from "vite-plus/test";
import { createConcreteRuntime, createNumericDomain, type NumericPredicate } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";
import { getExpressionSource, getPredicateSource } from "./helpers/numeric-expression.js";

let source: string;
beforeAll(async () => {
  source = (
    await buildScriptFixture(
      new URL("./fixtures/numeric-parity-react.tsx", import.meta.url),
      "production",
      false,
    )
  ).code;
});

it.each([1, 2, 5, -2, -0, NaN, Infinity])(
  "specializes real React parity and layout updates with step=%s",
  async (step) => {
    const domain = await createNumericDomain();
    const runtime = await createConcreteRuntime();
    const native = createNativeRuntime();
    const { api } = await getSymbolicEngine();
    const predicates: NumericPredicate[] = [];
    Object.assign(runtime.agent.hostDefinedOptions, domain.agentOptions, {
      evaluateAbstractNumberPredicate: (
        operation: Parameters<typeof domain.agentOptions.evaluateAbstractNumberPredicate>[0],
      ) => {
        const predicate = domain.getPredicate(
          domain.agentOptions.evaluateAbstractNumberPredicate(operation),
        );
        predicates.push(predicate);
        if (predicates.length > 100) throw new Error("Unexpected predicate expansion");
        const choice: unknown = runInNewContext(getPredicateSource(predicate), {
          inputs: { step },
        });
        if (typeof choice !== "boolean") throw new Error("Expected predicate choice");
        return api.Value(choice);
      },
    });
    try {
      const previous = api.surroundingAgent;
      api.setSurroundingAgent(runtime.agent);
      try {
        api.X(
          api.CreateDataPropertyOrThrow(
            runtime.realm.GlobalObject,
            "step",
            domain.createInput("step"),
          ),
        );
      } finally {
        api.setSurroundingAgent(previous);
      }
      runtime.evaluate(source);
      native.evaluate(source);
      native.evaluate(`var step = ${Object.is(step, -0) ? "-0" : String(step)};`);
      const counts: number[] = [];
      for (const command of [
        "fixture.mount(step)",
        "fixture.dispatch('step')",
        "fixture.dispatch('five')",
        "fixture.dispatch('reset')",
        "fixture.dispatch('subtract')",
        "fixture.unmount()",
      ]) {
        runtime.evaluate(command);
        runtime.drainJobs();
        native.evaluate(command);
        native.drainJobs();
        expect(runtime.readString("fixture.observe()")).toBe(native.evaluate("fixture.observe()"));
        const state = runtime.evaluate("fixture.currentState");
        if (!(state instanceof api.NumberValue)) throw new Error("Expected retained Number state");
        const value: unknown = runInNewContext(getExpressionSource(domain.getExpression(state)), {
          inputs: { step },
        });
        const expected: unknown = native.evaluate("fixture.currentState");
        expect(Object.is(value, expected)).toBe(true);
        if (typeof value !== "number") throw new Error("Expected specialized count");
        counts.push(value);
        if (command === "fixture.mount(step)")
          expect(api.NumberValue.isAbstract(state)).toBe(false);
        if (command === "fixture.dispatch('step')" && !Object.is(step, 0) && !Object.is(step, -0))
          expect(api.NumberValue.isAbstract(state)).toBe(true);
      }
      if (step === 1) expect(counts.slice(0, 5)).toEqual([0, 1, 6, 0, -5]);
      expect(
        predicates.some(
          (predicate) =>
            predicate.kind === "strict-equal" &&
            [predicate.left, predicate.right].some(
              (expression) =>
                expression.kind === "operation" && expression.operator === "remainder",
            ),
        ),
      ).toBe(step !== 0);
      expect(runtime.consoleEntries).toEqual([]);
      expect(runtime.uncaughtExceptions).toEqual([]);
      expect(runtime.unhandledRejections.size).toBe(0);
    } finally {
      runtime.dispose();
    }
  },
);
