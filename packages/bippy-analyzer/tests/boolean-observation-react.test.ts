import { expect, it } from "vite-plus/test";
import {
  createBooleanSnapshotExplorer,
  createConcreteRuntime,
  specializeGuardedHostTree,
} from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";

it("retains a returned React snapshot container while the explorer reads it", async () => {
  const runtime = await createConcreteRuntime();
  const explorer = await createBooleanSnapshotExplorer();
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
    runtime.evaluate("fixture.update(true, true)");
    runtime.drainJobs();
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(runtime.agent);
    try {
      const compiled = api.EnsureCompletion(
        runtime.realm.compileScript(`
        var observationReference;
        (() => {
          const target = { snapshot: JSON.stringify(JSON.parse(fixture.observe()).tree) };
          observationReference = new WeakRef(target);
          return target;
        })();
      `),
      );
      if (compiled.Type !== "normal") throw new Error("Expected script");
      runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
      const report = explorer.explore({
        agent: runtime.agent,
        inputs: [],
        createOwner: () => {
          throw new Error("Unexpected fork");
        },
        observe: (completion) => {
          const reference = runtime.realm.GlobalObject.properties.get(
            api.Value("observationReference"),
          )?.Value;
          if (
            !reference ||
            !api.isWeakRef(reference) ||
            !(completion.Value instanceof api.ObjectValue)
          )
            throw new Error("Expected target");
          runtime.agent.AgentRecord.KeptAlive.clear();
          api.gc();
          expect(reference.WeakRefTarget === completion.Value).toBe(true);
          const snapshot = completion.Value.properties.get(api.Value("snapshot"))?.Value;
          if (!(snapshot instanceof api.JSStringValue)) throw new Error("Expected snapshot");
          return { kind: "commit", snapshot: snapshot.stringValue() };
        },
      });
      expect(report.execution).toBe("not-verified");
      expect(report.exploration.forks).toBe(0);
      const selected = specializeGuardedHostTree(report, new Map());
      if (selected.kind !== "selected" || selected.outcome.kind !== "commit")
        throw new Error("Expected observation");
      expect(JSON.parse(selected.outcome.snapshot).props["data-status"]).toBe("enabled");
      const reference = runtime.realm.GlobalObject.properties.get(
        api.Value("observationReference"),
      )?.Value;
      if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
      runtime.agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(reference.WeakRefTarget).toBeUndefined();
    } finally {
      api.setSurroundingAgent(previous);
    }
    runtime.evaluate("fixture.unmount()");
    runtime.drainJobs();
  } finally {
    runtime.dispose();
  }
});
