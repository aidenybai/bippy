import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";

it("exposes a completion callback dependency at an actual React pause before owner capture", async () => {
  const runtime = await createConcreteRuntime();
  const { api } = await getSymbolicEngine();
  const source = (
    await buildScriptFixture(
      new URL("./fixtures/symbolic-react-tree.tsx", import.meta.url),
      "production",
    )
  ).code;
  let prefixes = 0;
  let captures = 0;
  const dependency = { notifications: 0 };
  const failure = new Error("Unowned completion callback state");
  try {
    runtime.evaluate(source);
    runtime.evaluate("fixture.mount()");
    runtime.drainJobs();
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(runtime.agent);
    try {
      const enabled = api.BooleanValue.createAbstract();
      api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "enabled", enabled));
      const onNodeEvaluation = runtime.agent.hostDefinedOptions.onNodeEvaluation;
      runtime.agent.hostDefinedOptions.onNodeEvaluation = (node, realm) => {
        onNodeEvaluation?.(node, realm);
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixes++;
      };
      const compiled = api.EnsureCompletion(
        runtime.realm.compileScript("void 1; fixture.update(enabled, false); fixture.observe();"),
      );
      if (compiled.Type !== "normal") throw new Error("Expected script");
      const callback = api.registerNativeClosure(
        () => {
          dependency.notifications++;
        },
        () => ({ bindings: [{ name: "dependency", get: () => dependency }], ambientNames: [] }),
      );
      runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), callback, false);
      const pause = runtime.agent.resumeEvaluate({
        pauseOnAbstractBoolean: true,
        noBreakpoint: true,
      });
      if (pause.done || !pause.value) throw new Error("Expected React decision");
      expect(() =>
        runtime.agent.captureEvaluation({
          references: (value) => {
            if (value === dependency) throw failure;
            return [];
          },
          capture: () => {
            captures++;
            throw new Error("Missing callback dependency");
          },
        }),
      ).toThrow(failure);
      expect(captures).toBe(0);
      expect(dependency.notifications).toBe(0);
      expect(prefixes).toBe(1);
      expect(runtime.agent.resumeEvaluate().value === pause.value).toBe(true);
      expect(() => runtime.agent.assertCanPerformHostEffect()).not.toThrow();
    } finally {
      api.setSurroundingAgent(previous);
    }
  } finally {
    runtime.dispose();
  }
});
