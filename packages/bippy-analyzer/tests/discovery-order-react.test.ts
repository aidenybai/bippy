import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";

it("rejects a notification at a React pause before expanding its public metadata", async () => {
  const runtime = await createConcreteRuntime();
  const { api } = await getSymbolicEngine();
  const source = (
    await buildScriptFixture(
      new URL("./fixtures/symbolic-react-tree.tsx", import.meta.url),
      "production",
    )
  ).code;
  try {
    runtime.evaluate(source);
    runtime.evaluate("fixture.mount()");
    runtime.drainJobs();
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(runtime.agent);
    try {
      api.X(
        api.CreateDataPropertyOrThrow(
          runtime.realm.GlobalObject,
          "enabled",
          api.BooleanValue.createAbstract(),
        ),
      );
      const compiled = api.EnsureCompletion(
        runtime.realm.compileScript("var prefix = 0; prefix++; fixture.update(enabled, false);"),
      );
      if (compiled.Type !== "normal") throw new Error("Expected script");
      let factories = 0,
        captures = 0,
        notifications = 0;
      const callback = api.registerNativeClosure(
        () => {
          notifications++;
        },
        () => {
          factories++;
          return { bindings: [], ambientNames: [] };
        },
      );
      runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), callback, false);
      const pause = runtime.agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected pause");
      const failure = new Error("Unadmitted React completion notification");
      let caught: unknown;
      try {
        runtime.agent.captureEvaluation({
          references: (value) => {
            if (value === callback && api.getNativeSourceModule(value) === undefined) throw failure;
            return [];
          },
          capture: () => {
            captures++;
            return { restore: () => {} };
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      expect([factories, captures, notifications]).toEqual([0, 0, 0]);
      expect(runtime.realm.GlobalObject.properties.get("prefix")?.Value).toEqual(api.Value(1));
      expect(runtime.agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(
        pause.value,
      );
      expect(() => runtime.agent.assertCanPerformHostEffect()).not.toThrow();
    } finally {
      api.setSurroundingAgent(previous);
    }
  } finally {
    runtime.dispose();
  }
});
