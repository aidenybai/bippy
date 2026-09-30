import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";

it.each([false, true])(
  "keeps a declared completion target live through an actual React pause, enabled=%s",
  async (choice) => {
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
      const target = runtime.evaluate(
        "var notificationTarget = {}; var notificationReference = new WeakRef(notificationTarget); notificationTarget",
      );
      runtime.evaluate("notificationTarget = null");
      const previous = api.surroundingAgent;
      api.setSurroundingAgent(runtime.agent);
      try {
        const reference = runtime.realm.GlobalObject.properties.get(
          api.Value("notificationReference"),
        )?.Value;
        if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
        const enabled = api.BooleanValue.createAbstract();
        api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "enabled", enabled));
        let notifications = 0;
        let pauses = 0;
        const collect = () => {
          runtime.agent.AgentRecord.KeptAlive.clear();
          api.gc();
        };
        const callback = api.registerNativeClosure(
          () => {
            notifications++;
            collect();
            expect(reference.WeakRefTarget === target).toBe(true);
          },
          () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
        );
        const compiled = api.EnsureCompletion(
          runtime.realm.compileScript("fixture.update(enabled, false); fixture.observe();"),
        );
        if (compiled.Type !== "normal") throw new Error("Expected script");
        runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), callback, false);
        let step = runtime.agent.resumeEvaluate({
          pauseOnAbstractBoolean: true,
          noBreakpoint: true,
        });
        while (!step.done) {
          if (!step.value || step.value.value !== enabled) throw new Error("Unexpected decision");
          pauses++;
          collect();
          expect(reference.WeakRefTarget === target).toBe(true);
          step = runtime.agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: step.value,
              value: choice,
            },
            noBreakpoint: true,
          });
        }
        expect(pauses).toBeGreaterThan(0);
        expect(notifications).toBe(1);
        collect();
        expect(reference.WeakRefTarget === undefined).toBe(true);
      } finally {
        api.setSurroundingAgent(previous);
      }
      runtime.drainJobs();
      runtime.evaluate("fixture.unmount()");
      runtime.drainJobs();
    } finally {
      runtime.dispose();
    }
  },
);
