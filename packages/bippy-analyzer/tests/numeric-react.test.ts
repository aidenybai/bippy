import { beforeAll, expect, it } from "vite-plus/test";
import { createConcreteRuntime, createNumericDomain, type NumericPredicate } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";
import { getReactCheckpointRecords } from "./helpers/react-checkpoint-records.js";
import { getExpressionSource, getPredicateSource } from "./helpers/numeric-expression.js";

let source: string;
beforeAll(async () => {
  const chunk = await buildScriptFixture(
    new URL("./fixtures/numeric-react.tsx", import.meta.url),
    "production",
    false,
  );
  expect(Object.keys(chunk.modules).some((name) => name.includes("react-test-renderer"))).toBe(
    true,
  );
  source = chunk.code;
});

it.each([false, true])(
  "drives real React's unknown Number bailout, SameValue=%s",
  async (choice) => {
    const domain = await createNumericDomain({ maxPredicates: 1 });
    const runtime = await createConcreteRuntime();
    const { api } = await getSymbolicEngine();
    const observations: string[] = [];
    const decisions: NumericPredicate[] = [];
    Object.assign(runtime.agent.hostDefinedOptions, domain.agentOptions);
    try {
      const previous = api.surroundingAgent;
      api.setSurroundingAgent(runtime.agent);
      try {
        api.X(
          api.CreateDataPropertyOrThrow(
            runtime.realm.GlobalObject,
            "amount",
            domain.createInput("amount"),
          ),
        );
      } finally {
        api.setSurroundingAgent(previous);
      }
      runtime.evaluate(source);
      expect(runtime.readString("JSON.stringify(fixture.versions)")).toBe('["19.3.0","19.3.0"]');
      runtime.evaluate("fixture.mount(amount)");
      runtime.drainJobs();
      observations.push(runtime.readString("fixture.observe()"));

      api.setSurroundingAgent(runtime.agent);
      try {
        const compiled = api.EnsureCompletion(runtime.realm.compileScript("fixture.increment()"));
        if (compiled.Type !== "normal") throw new Error("Expected a compiled increment");
        runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
        let step = runtime.agent.resumeEvaluate({
          pauseOnAbstractBoolean: true,
          noBreakpoint: true,
        });
        while (!step.done) {
          const decision = step.value;
          if (!decision) throw new Error("Unexpected debugger suspension");
          const predicate = domain.getPredicate(decision.value);
          if (decisions.length >= 10) throw new Error("Unexpected decision expansion");
          if (decisions.length > 0) expect(predicate === decisions[0]).toBe(true);
          decisions.push(predicate);
          if (decisions.length === 1) {
            const rejection = new Error("React transitive ownership is not implemented");
            expect(() =>
              runtime.agent.captureEvaluation({
                capture: (roots) => {
                  const { fiber, queue, update } = getReactCheckpointRecords(api, roots);
                  expect(
                    queue.properties.get("lastRenderedState")?.Value ===
                      domain.createInput("amount"),
                  ).toBe(true);
                  expect(update.properties.get("hasEagerState")?.Value === api.Value.true).toBe(
                    true,
                  );
                  const eagerState = update.properties.get("eagerState")?.Value;
                  if (!(eagerState instanceof api.NumberValue))
                    throw new Error("Expected eager Number state");
                  expect(getExpressionSource(domain.getExpression(eagerState))).toBe(
                    '((inputs["amount"])+(1))',
                  );
                  const dispatch = queue.properties.get("dispatch")?.Value;
                  if (
                    !(dispatch instanceof api.ObjectValue) ||
                    !api.isBoundFunctionObject(dispatch)
                  )
                    throw new Error("Expected bound React dispatch");
                  expect(dispatch.BoundArguments[0] === fiber).toBe(true);
                  expect(dispatch.BoundArguments[1] === queue).toBe(true);
                  expect(fiber.ConstructedBy).toHaveLength(1);
                  expect(() => api.createStateCheckpoint({ objects: [fiber] })).toThrow(
                    "Checkpoint requires",
                  );
                  const selected = api.createStateCheckpoint({ objects: [queue, update] });
                  try {
                    expect(() => api.createDataGraphCheckpoint({ roots: [update] })).toThrow(
                      /Data graph cannot|Checkpoint requires/,
                    );
                  } finally {
                    selected.release();
                  }
                  throw rejection;
                },
              }),
            ).toThrow(rejection);
            expect(runtime.agent.resumeEvaluate().value === decision).toBe(true);
          }
          runtime.agent.AgentRecord.KeptAlive.clear();
          api.gc();
          step = runtime.agent.resumeEvaluate({
            noBreakpoint: true,
            abstractBooleanDecision: { resume: "abstract-boolean", decision, value: choice },
          });
        }
        expect(api.EnsureCompletion(step.value).Type).toBe("normal");
        expect(runtime.agent.isPaused()).toBe(false);
      } finally {
        api.setSurroundingAgent(previous);
      }
      expect(decisions.length).toBeGreaterThan(0);
      expect(getPredicateSource(decisions[0])).toBe(
        'Object.is(((inputs["amount"])+(1)),inputs["amount"])',
      );
      runtime.drainJobs();
      observations.push(runtime.readString("fixture.observe()"));
      expect(JSON.parse(observations[0]).renders).toBe(1);
      expect(JSON.parse(observations[1]).renders).toBe(choice ? 1 : 2);
      expect(runtime.evaluate("amount") === domain.createInput("amount")).toBe(true);
      const current = runtime.evaluate("fixture.currentState");
      if (!(current instanceof api.NumberValue)) throw new Error("Expected an engine Number state");
      expect(api.NumberValue.isAbstract(current)).toBe(true);
      expect(getExpressionSource(domain.getExpression(current))).toBe(
        choice ? 'inputs["amount"]' : '((inputs["amount"])+(1))',
      );
      runtime.evaluate("fixture.unmount()");
      runtime.drainJobs();
      observations.push(runtime.readString("fixture.observe()"));
      expect(runtime.unhandledRejections.size).toBe(0);
      expect(runtime.uncaughtExceptions).toEqual([]);
      expect(runtime.consoleEntries).toEqual([]);

      const witnesses = [
        NaN,
        Infinity,
        -Infinity,
        -0,
        0,
        1,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        Number.MAX_SAFE_INTEGER,
        2 ** 53,
      ];
      let matched = 0;
      for (const amount of witnesses) {
        if (Object.is(amount + 1, amount) !== choice) continue;
        matched++;
        const native = createNativeRuntime();
        native.evaluate(source);
        const amountSource = Object.is(amount, -0) ? "-0" : String(amount);
        const expected: string[] = [];
        for (const command of [
          `fixture.mount(${amountSource})`,
          "fixture.increment()",
          "fixture.unmount()",
        ]) {
          native.evaluate(command);
          native.drainJobs();
          const observation = native.evaluate("fixture.observe()");
          if (typeof observation !== "string") throw new Error("Expected a native observation");
          expected.push(observation);
        }
        expect(observations).toEqual(expected);
        expect(native.consoleEntries).toEqual([]);
      }
      expect(matched).toBeGreaterThan(0);
    } finally {
      runtime.dispose();
    }
  },
);
