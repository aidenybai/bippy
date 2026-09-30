import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";

it("rejects unsupported React storage instead of accepting a partial descriptor graph", async () => {
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
      const fixture = runtime.realm.GlobalObject.properties.get("fixture")?.Value;
      if (!(fixture instanceof api.ObjectValue)) throw new Error("Expected fixture");
      const descriptor = api.Descriptor({ Value: fixture });
      const compiled = api.EnsureCompletion(
        runtime.realm.compileScript("var prefix=0; prefix++; fixture.update(enabled, false)"),
      );
      if (compiled.Type !== "normal") throw new Error("Expected script");
      let observations = 0,
        captures = 0;
      runtime.agent.evaluate(
        api.ScriptEvaluation(compiled.Value),
        () => {
          observations++;
        },
        false,
      );
      const pause = runtime.agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected pause");
      const outer = api.createStateCheckpoint();
      try {
        expect(() =>
          runtime.agent.captureEvaluation({
            capture: () => {
              captures++;
              return api.createDescriptorGraphCheckpoint({ roots: [descriptor] });
            },
          }),
        ).toThrow(
          "Checkpoint requires ordinary objects or supported exotic objects and functions without additional internal state",
        );
        outer.restore();
      } finally {
        outer.release();
      }
      expect([captures, observations]).toEqual([1, 0]);
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
