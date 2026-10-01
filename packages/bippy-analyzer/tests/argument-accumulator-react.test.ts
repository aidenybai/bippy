import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";

it("selects allocated argument storage at a React pause without accepting the execution graph", async () => {
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
      const lists = new Set<unknown[]>();
      const failure = new Error("React execution ownership is not implemented");
      let caught: unknown;
      try {
        runtime.agent.captureEvaluation({
          references: (value) => {
            const storage = api.getArgumentAccumulatorStorage(value);
            if (!storage) return [];
            lists.add(storage.list);
            return [...storage.references, ...storage.borrowedReferences];
          },
          capture: () => {
            captures++;
            expect(lists.size).toBeGreaterThan(0);
            const saved = api.createStateCheckpoint({ nativeLists: [...lists] });
            expect(saved.nativeListCount).toBe(lists.size);
            saved.release();
            throw failure;
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      expect([captures, observations]).toEqual([1, 0]);
      expect(runtime.realm.GlobalObject.properties.get(api.Value("prefix"))?.Value).toEqual(
        api.Value(1),
      );
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
