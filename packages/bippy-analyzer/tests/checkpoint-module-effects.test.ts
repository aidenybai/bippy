import { expect, it } from "vite-plus/test";
import type {
  EvaluationCheckpoint,
  ModuleRequestRecord,
  HostLoadImportedModulePayloadOpaque,
  SourceTextModuleRecord,
} from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

it.each([false, true])(
  "guards cold import.meta while allowing an already initialized value, warm=%s",
  async (warm) => {
    const runtime = await createConcreteRuntime({
      modules: [
        { specifier: "file:///meta.js", source: "export const read = () => import.meta.url;" },
      ],
    });
    const { api } = await getSymbolicEngine();
    const previous = api.surroundingAgent;
    let checkpoint: EvaluationCheckpoint | undefined;
    try {
      runtime.evaluate('var read; import("file:///meta.js").then(module => {read = module.read;})');
      runtime.drainJobs();
      if (warm) expect(runtime.readString("read()")).toBe("file:///meta.js");
      let reads = 0;
      const original = runtime.realm.HostDefined.getImportMetaProperties;
      Object.defineProperty(runtime.realm.HostDefined, "getImportMetaProperties", {
        configurable: true,
        get: () => {
          reads++;
          return original;
        },
      });
      api.setSurroundingAgent(runtime.agent);
      api.X(
        api.CreateDataPropertyOrThrow(
          runtime.realm.GlobalObject,
          "enabled",
          api.BooleanValue.createAbstract(),
        ),
      );
      const compiled = api.EnsureCompletion(
        runtime.realm.compileScript(
          "var caught = false; if (enabled) {try {read();} catch (error) {caught = true;}}",
        ),
      );
      if (compiled.Type !== "normal") throw Error("Expected script");
      let observed: string | undefined;
      runtime.agent.evaluate(
        api.ScriptEvaluation(compiled.Value),
        (completion) => {
          if (completion.Type !== "normal" || !(completion.Value instanceof api.JSStringValue))
            throw Error("Expected URL string");
          observed = completion.Value.stringValue();
        },
        false,
      );
      const pause = runtime.agent.resumeEvaluate({
        pauseOnAbstractBoolean: true,
        noBreakpoint: true,
      });
      if (pause.done || !pause.value) throw Error("Expected pause");
      const decision = pause.value;
      checkpoint = runtime.agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
      const resume = () =>
        runtime.agent.resumeEvaluate({
          abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
        });
      if (warm) {
        expect(resume().done).toBe(true);
        expect(observed).toBe("file:///meta.js");
      } else {
        expect(resume).toThrow("Host effects are unsupported during evaluation checkpoints");
        expect(observed).toBeUndefined();
      }
      expect(reads).toBe(0);
      expect(runtime.realm.GlobalObject.properties.get("caught")?.Value).toBe(api.Value.false);
    } finally {
      api.setSurroundingAgent(runtime.agent);
      checkpoint?.release();
      api.setSurroundingAgent(previous);
      runtime.dispose();
    }
  },
);

it("rejects concrete artifact loading before ModuleCache.load", async () => {
  const runtime = await createConcreteRuntime({
    modules: [{ specifier: "file:///lazy.js", source: "export const value = 1;" }],
  });
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  let checkpoint: EvaluationCheckpoint | undefined;
  try {
    api.setSurroundingAgent(runtime.agent);
    const cache = api.ModuleCache.fromReferer(runtime.realm);
    const original = cache.load;
    let loads = 0;
    cache.load = (...parameters) => {
      loads++;
      return Reflect.apply(original, cache, parameters);
    };
    api.X(
      api.CreateDataPropertyOrThrow(
        runtime.realm.GlobalObject,
        "enabled",
        api.BooleanValue.createAbstract(),
      ),
    );
    const compiled = api.EnsureCompletion(
      runtime.realm.compileScript('if (enabled) import("file:///lazy.js");'),
    );
    if (compiled.Type !== "normal") throw Error("Expected script");
    runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
    const pause = runtime.agent.resumeEvaluate({
      pauseOnAbstractBoolean: true,
      noBreakpoint: true,
    });
    if (pause.done || !pause.value) throw Error("Expected pause");
    const decision = pause.value;
    checkpoint = runtime.agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    expect(() =>
      runtime.agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
      }),
    ).toThrow("Host effects are unsupported during evaluation checkpoints");
    expect(loads).toBe(0);
  } finally {
    api.setSurroundingAgent(runtime.agent);
    checkpoint?.release();
    api.setSurroundingAgent(previous);
    runtime.dispose();
  }
});

interface ModuleCheckpointFixture extends AbstractFixture {
  checkpoint: EvaluationCheckpoint;
  module: SourceTextModuleRecord;
  request: ModuleRequestRecord;
  payload: HostLoadImportedModulePayloadOpaque;
}

const withModuleCheckpoint = async (run: (fixture: ModuleCheckpointFixture) => void) => {
  await withAbstractFixture((fixture) => {
    const { api, agent, realm, createBoolean, compile } = fixture;
    const result = api.EnsureCompletion(realm.compileModule("export const value = 1;"));
    if (result.Type !== "normal") throw Error("Expected module");
    let payload: HostLoadImportedModulePayloadOpaque | undefined;
    const hooks = agent.hostDefinedOptions.hostHooks;
    agent.hostDefinedOptions.hostHooks = {
      HostLoadImportedModule: (_referrer, _request, _hostDefined, received) => {
        payload = received;
      },
    };
    fixture.evaluate('import("file:///lazy.js")');
    agent.hostDefinedOptions.hostHooks = hooks;
    if (!payload) throw Error("Expected engine-created opaque payload");
    createBoolean("enabled");
    agent.evaluate(compile("if (enabled) { void 1; }"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
    if (pause.done || !pause.value) throw Error("Expected pause");
    const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    try {
      run({
        ...fixture,
        checkpoint,
        module: result.Value,
        request: {
          Specifier: "file:///lazy.js",
          Attributes: [],
          Phase: "evaluation",
          ImportedNames: "all",
        },
        payload,
      });
    } finally {
      checkpoint.release();
    }
  });
};

it.each(["load", "source", "attributes", "meta", "finalize"])(
  "rejects module hook lookup and invocation: %s",
  async (kind) => {
    await withModuleCheckpoint(({ api, agent, realm, module, request, payload, checkpoint }) => {
      let reads = 0,
        calls = 0;
      agent.hostDefinedOptions.hostHooks = {};
      const target =
        kind === "meta" || kind === "finalize"
          ? realm.HostDefined
          : kind === "attributes"
            ? agent.hostDefinedOptions
            : agent.hostDefinedOptions.hostHooks;
      const key =
        kind === "load"
          ? "HostLoadImportedModule"
          : kind === "source"
            ? "HostGetModuleSourceModuleRecord"
            : kind === "attributes"
              ? "supportedImportAttributes"
              : kind === "meta"
                ? "getImportMetaProperties"
                : "finalizeImportMeta";
      Object.defineProperty(target, key, {
        configurable: true,
        get: () => {
          reads++;
          return kind === "attributes"
            ? []
            : () => {
                calls++;
                return kind === "source" ? "not-a-source" : kind === "meta" ? [] : undefined;
              };
        },
      });
      const effect = () => {
        if (kind === "load") return api.HostLoadImportedModule(realm, request, undefined, payload);
        if (kind === "source") return api.HostGetModuleSourceModuleRecord(realm.GlobalObject);
        if (kind === "attributes") return api.HostGetSupportedImportAttributes();
        if (kind === "meta") return api.HostGetImportMetaProperties(module);
        return api.HostFinalizeImportMeta(realm.GlobalObject, module);
      };
      expect(effect).toThrow("Host effects are unsupported during evaluation checkpoints");
      expect(reads).toBe(0);
      expect(calls).toBe(0);
      checkpoint.restore();
      Reflect.deleteProperty(target, key);
    });
  },
);

it("rejects loader completion before reading payload or changing LoadedModules", async () => {
  await withModuleCheckpoint(({ api, realm, module, request, payload }) => {
    const loaded = realm.LoadedModules;
    let reads = 0;
    const data = Object.getOwnPropertyDescriptor(payload, "data")?.value;
    Object.defineProperty(payload, "data", {
      get: () => {
        reads++;
        return data;
      },
    });
    expect(() => api.FinishLoadingImportedModule(realm, request, payload, module)).toThrow(
      "Host effects are unsupported during evaluation checkpoints",
    );
    expect(realm.LoadedModules).toBe(loaded);
    expect(loaded).toHaveLength(0);
    expect(reads).toBe(0);
  });
});

it.each([false, true])(
  "rejects dynamic import before the loader, attributes=%s",
  async (attributes) => {
    await withAbstractFixture(({ api, agent, realm, createBoolean, compile }) => {
      let loads = 0;
      agent.hostDefinedOptions.hostHooks = {
        HostLoadImportedModule: () => {
          loads++;
        },
      };
      createBoolean("enabled");
      agent.evaluate(
        compile(
          `var caught = false, finished = false; if (enabled) { try { import("file:///lazy.js"${attributes ? ', {with: {type: "json"}}' : ""}); } catch (error) {caught = true;} finished = true; }`,
        ),
        () => {},
        false,
      );
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const decision = pause.value;
      const saved = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
      const resume = () =>
        agent.resumeEvaluate({
          abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
        });
      let failure: unknown;
      try {
        try {
          resume();
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(TypeError);
        expect(failure).toHaveProperty(
          "message",
          "Host effects are unsupported during evaluation checkpoints",
        );
        expect(loads).toBe(0);
        expect(realm.GlobalObject.properties.get("caught")?.Value).toBe(api.Value.false);
        expect(realm.GlobalObject.properties.get("finished")?.Value).toBe(api.Value.false);
        for (const retry of [resume, saved.restore]) {
          let repeated: unknown;
          try {
            retry();
          } catch (error) {
            repeated = error;
          }
          expect(repeated).toBe(failure);
        }
      } finally {
        saved.release();
      }
    });
  },
);

it.each(["capture", "restore"])("guards module hooks during owner %s", async (phase) => {
  await withAbstractFixture(({ api, agent, realm, createBoolean, compile }) => {
    let calls = 0;
    agent.hostDefinedOptions.hostHooks = {
      HostGetModuleSourceModuleRecord: () => {
        calls++;
        return "not-a-source";
      },
    };
    createBoolean("enabled");
    agent.evaluate(compile("if (enabled) { void 1; }"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
    if (pause.done || !pause.value) throw Error("Expected decision");
    const effect = () => api.HostGetModuleSourceModuleRecord(realm.GlobalObject);
    if (phase === "capture") {
      expect(() =>
        agent.captureEvaluation({
          capture: () => {
            effect();
            return { restore: () => {} };
          },
        }),
      ).toThrow("Host effects are unsupported during evaluation checkpoints");
      expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true }).value).toBe(
        pause.value,
      );
      expect(
        agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: false,
          },
        }).done,
      ).toBe(true);
    } else {
      const saved = agent.captureEvaluation({ capture: () => ({ restore: effect }) });
      try {
        expect(() => saved.restore()).toThrow(
          "Host effects are unsupported during evaluation checkpoints",
        );
      } finally {
        saved.release();
      }
    }
    expect(calls).toBe(0);
  });
});

it("preserves module hook behavior outside checkpoints and after release", async () => {
  await withAbstractFixture(({ api, agent, realm, createBoolean, compile }) => {
    let calls = 0;
    agent.hostDefinedOptions.hostHooks = {
      HostGetModuleSourceModuleRecord: () => {
        calls++;
        return "not-a-source";
      },
    };
    expect(api.HostGetModuleSourceModuleRecord(realm.GlobalObject)).toBe("not-a-source");
    createBoolean("enabled");
    agent.evaluate(compile("if (enabled) { void 1; }"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
    if (pause.done || !pause.value) throw Error("Expected decision");
    const saved = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    saved.release();
    expect(api.HostGetModuleSourceModuleRecord(realm.GlobalObject)).toBe("not-a-source");
    expect(calls).toBe(2);
  });
});
