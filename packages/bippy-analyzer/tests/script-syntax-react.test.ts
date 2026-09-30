import { expect, it } from "vite-plus/test";
import type { ScriptSyntaxRegion } from "../engine/dist/declaration/index.mjs";
import { createBooleanSnapshotExplorer, createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";

it("classifies finalized React syntax but still rejects unowned execution state", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  const runtime = await createConcreteRuntime();
  const { api } = await getSymbolicEngine();
  const source = (
    await buildScriptFixture(
      new URL("./fixtures/symbolic-react-tree.tsx", import.meta.url),
      "production",
    )
  ).code;
  const regions = new Set<ScriptSyntaxRegion>();
  let syntaxLists = 0,
    observations = 0,
    releases = 0,
    prefixes = 0;
  runtime.agent.hostDefinedOptions.scriptSyntax = { maxRecords: 500000, maxEntries: 4000000 };
  try {
    runtime.evaluate(source);
    runtime.evaluate("fixture.mount()");
    runtime.drainJobs();
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(runtime.agent);
    try {
      const enabled = api.BooleanValue.createAbstract();
      const details = api.BooleanValue.createAbstract();
      api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "enabled", enabled));
      api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "details", details));
      const onNodeEvaluation = runtime.agent.hostDefinedOptions.onNodeEvaluation;
      runtime.agent.hostDefinedOptions.onNodeEvaluation = (node, realm) => {
        onNodeEvaluation?.(node, realm);
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixes++;
      };
      const script = api.ParseScript(
        "void 1; fixture.update(enabled, details); fixture.observe();",
        runtime.realm,
      );
      if (Array.isArray(script)) throw new Error("Expected script");
      runtime.agent.evaluate(api.ScriptEvaluation(script), () => {}, false);
      expect(() =>
        explorer.explore({
          agent: runtime.agent,
          inputs: [
            { name: "enabled", value: enabled },
            { name: "details", value: details },
          ],
          createOwner: () => ({
            references: (value) => {
              const region = api.getScriptSyntaxRegion(value);
              if (region) {
                regions.add(region);
                if (Array.isArray(value) && Object.hasOwn(value, "location")) syntaxLists++;
              }
              return [];
            },
            capture: () => {
              expect(regions.size).toBeGreaterThan(0);
              expect(syntaxLists).toBeGreaterThan(0);
              for (const region of regions) region.validate();
              throw new Error("React transitive ownership is not implemented");
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
      ).toThrow("React transitive ownership is not implemented");
      expect(prefixes).toBe(1);
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
