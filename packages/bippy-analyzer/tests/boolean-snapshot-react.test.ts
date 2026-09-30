import { expect, it } from "vite-plus/test";
import { createBooleanSnapshotExplorer, createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";

it("stops actual React exploration when the supplied owner rejects its state", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  const runtime = await createConcreteRuntime();
  const { api } = await getSymbolicEngine();
  const source = (
    await buildScriptFixture(
      new URL("./fixtures/symbolic-react-tree.tsx", import.meta.url),
      "production",
    )
  ).code;
  const failure = new Error("React transitive ownership is not implemented");
  let prefixes = 0,
    captures = 0,
    releases = 0,
    observations = 0;
  try {
    runtime.evaluate(source);
    runtime.evaluate("fixture.mount()");
    runtime.drainJobs();
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(runtime.agent);
    try {
      const enabled = api.BooleanValue.createAbstract(),
        details = api.BooleanValue.createAbstract();
      api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "enabled", enabled));
      api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "details", details));
      const onNodeEvaluation = runtime.agent.hostDefinedOptions.onNodeEvaluation;
      runtime.agent.hostDefinedOptions.onNodeEvaluation = (node, realm) => {
        onNodeEvaluation?.(node, realm);
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixes++;
      };
      const compiled = api.EnsureCompletion(
        runtime.realm.compileScript("void 1; fixture.update(enabled, details); fixture.observe();"),
      );
      if (compiled.Type !== "normal") throw new Error("Expected script");
      runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
      expect(() =>
        explorer.explore({
          agent: runtime.agent,
          inputs: [
            { name: "enabled", value: enabled },
            { name: "details", value: details },
          ],
          createOwner: () => ({
            capture: (roots) => {
              captures++;
              expect(roots.values.some((value) => value instanceof api.ObjectValue)).toBe(true);
              throw failure;
            },
            release: () => {
              releases++;
            },
          }),
          observe: () => {
            observations++;
            return { kind: "commit", snapshot: "null" };
          },
        }),
      ).toThrow(failure);
      expect(prefixes).toBe(1);
      expect(captures).toBe(1);
      expect(releases).toBe(1);
      expect(observations).toBe(0);
      expect(() => runtime.agent.assertCanPerformHostEffect()).not.toThrow();
    } finally {
      api.setSurroundingAgent(previous);
    }
  } finally {
    runtime.dispose();
  }
});
