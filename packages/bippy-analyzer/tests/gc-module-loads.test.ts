import { expect, it } from "vite-plus/test";
import type { AbstractModuleRecord, PlainCompletion } from "../engine/dist/declaration/index.mjs";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { getCollectedReference } from "./helpers/concrete-gc.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface PendingModule {
  finish: (result: PlainCompletion<AbstractModuleRecord>) => void;
}

const getSetup = (promise: string, target: string): string => `
  var reference, seen;
  (() => {
    const held = ${target};
    reference = new WeakRef(held);
    ${promise}.then(
      () => {seen = reference.deref() === held;},
      () => {seen = reference.deref() === held;}
    );
  })();
`;

it.each(["visited", "previously-imported"])(
  "marks modules in the graph's %s records and releases removed edges",
  async (field) => {
    const runtime = await createConcreteRuntime();
    const { api } = await getSymbolicEngine();
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(runtime.agent);
    const pop = runtime.realm.pushTopContext();
    try {
      const compiled = api.EnsureCompletion(runtime.realm.compileModule(""));
      if (compiled.Type !== "normal") throw Error("Expected module");
      compiled.Value.LoadRequestedModules();
      expect(api.EnsureCompletion(compiled.Value.Link()).Type).toBe("normal");
      const namespace = api.GetModuleNamespace(compiled.Value, "evaluation");
      const graph = new api.GraphLoadingState({
        PromiseCapability: api.X(api.NewPromiseCapability(runtime.agent.intrinsic("%Promise%"))),
      });
      if (field === "visited") graph.Visited.add(compiled.Value);
      else graph.PreviouslyImportedNames.push({ Module: compiled.Value, ImportedNames: "all" });
      const state = runtime.agent.hostDefinedOptions.hostDefinedState;
      runtime.agent.hostDefinedOptions.hostDefinedState = {
        mark: (marker) => {
          marker(state);
          marker(graph);
        },
      };
      api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "namespace", namespace));
      runtime.evaluate("var reference = new WeakRef(namespace); namespace = undefined;");
      expect(await getCollectedReference(runtime)).toBe("true");
      graph.Visited.clear();
      graph.PreviouslyImportedNames.length = 0;
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      pop?.();
      api.setSurroundingAgent(previous);
      runtime.dispose();
    }
  },
);

it.each(["{}", "Symbol('held')"])(
  "native pending import retains %s through a reaction",
  (target) => {
    const source =
      "await new Promise(resolve => {globalThis.finishLoad = resolve}); export const value = 1;";
    const specifier = `data:text/javascript,${encodeURIComponent(source)}`;
    expect(
      getNativeGcObservation(
        getSetup(`import(${JSON.stringify(specifier)})`, target),
        "String(reference.deref() !== undefined)",
      ),
    ).toBe("true");
  },
);

it.each(
  ["dynamic", "graph", "nested"].flatMap((kind) =>
    [false, true].flatMap((reject) =>
      ["{}", "Symbol('held')"].map((target) => ({ kind, reject, target })),
    ),
  ),
)(
  "retains $target while $kind loading is pending, reject=$reject",
  async ({ kind, reject, target }) => {
    const runtime = await createConcreteRuntime();
    const { api } = await getSymbolicEngine();
    const withAgent = <Result>(run: () => Result): Result => {
      const previous = api.surroundingAgent;
      api.setSurroundingAgent(runtime.agent);
      const pop = runtime.realm.pushTopContext();
      try {
        return run();
      } finally {
        pop?.();
        api.setSurroundingAgent(previous);
      }
    };
    const pending: PendingModule[] = [];
    runtime.agent.hostDefinedOptions.hostHooks = {
      ...runtime.agent.hostDefinedOptions.hostHooks,
      HostLoadImportedModule: (referrer, request, _hostDefined, payload) => {
        pending.push({
          finish: (result) => api.FinishLoadingImportedModule(referrer, request, payload, result),
        });
      },
    };
    try {
      if (kind === "dynamic") runtime.evaluate(getSetup('import("file:///entry.js")', target));
      else {
        withAgent(() => {
          const entry = api.EnsureCompletion(
            runtime.realm.compileModule('import "file:///dependency.js";'),
          );
          if (entry.Type !== "normal") throw Error("Expected entry module");
          const promise = entry.Value.LoadRequestedModules();
          api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "loading", promise));
        });
        runtime.evaluate(getSetup("loading", target) + "loading = undefined;");
      }
      expect(pending).toHaveLength(1);
      expect(await getCollectedReference(runtime)).toBe("true");
      if (kind === "nested") {
        withAgent(() => {
          const middle = api.EnsureCompletion(
            runtime.realm.compileModule('import "file:///leaf.js";'),
          );
          if (middle.Type !== "normal") throw Error("Expected middle module");
          pending[0].finish(middle.Value);
        });
        expect(pending).toHaveLength(2);
        expect(await getCollectedReference(runtime)).toBe("true");
      }
      withAgent(() => {
        const result = reject
          ? api.ThrowCompletion(api.Value.undefined)
          : api.EnsureCompletion(runtime.realm.compileModule("export const value = 1;"));
        pending.at(-1)!.finish(result);
      });
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.drainJobs();
      expect(runtime.readString("String(seen)")).toBe("true");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);
