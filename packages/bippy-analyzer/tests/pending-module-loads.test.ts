import { expect, it } from "vite-plus/test";
import type {
  EvaluationCheckpoint,
  PlainCompletion,
  AbstractModuleRecord,
  HostLoadImportedModulePayloadOpaque,
} from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

interface PendingLoad {
  specifier: string;
  payload: HostLoadImportedModulePayloadOpaque;
  finish: (result?: PlainCompletion<AbstractModuleRecord>) => void;
}

const getPendingLoads = ({ api, agent }: AbstractFixture): PendingLoad[] => {
  const loads: PendingLoad[] = [];
  agent.hostDefinedOptions.hostHooks = {
    HostLoadImportedModule: (referrer, request, _hostDefined, payload) => {
      loads.push({
        specifier: request.Specifier,
        payload,
        finish: (result = api.ThrowCompletion(api.Value.undefined)) =>
          api.FinishLoadingImportedModule(referrer, request, payload, result),
      });
    },
  };
  return loads;
};

const getPause = (fixture: AbstractFixture) => {
  fixture.createBoolean("enabled");
  fixture.agent.evaluate(fixture.compile("if (enabled) { void 1; }"), () => {}, false);
  const pause = fixture.agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
  if (pause.done || !pause.value) throw Error("Expected decision");
  return pause.value;
};

const getCheckpoint = (fixture: AbstractFixture) =>
  fixture.agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });

it("rejects before owner access without consuming the pending decision", async () => {
  await withAbstractFixture((fixture) => {
    const loads = getPendingLoads(fixture);
    expect(fixture.evaluate('import("file:///delayed.js")').Type).toBe("normal");
    expect(fixture.agent.eventLoop.hasPendingJobs).toBe(false);
    const decision = getPause(fixture);
    let reads = 0;
    expect(() =>
      fixture.agent.captureEvaluation({
        get capture() {
          reads++;
          return () => ({ restore: () => {} });
        },
      }),
    ).toThrow("Evaluation checkpoints do not support pending module loads");
    expect(reads).toBe(0);
    expect(
      fixture.agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true }).value,
    ).toBe(decision);
    loads[0].finish();
    const checkpoint = getCheckpoint(fixture);
    try {
      checkpoint.restore();
      expect(
        fixture.agent.resumeEvaluate({
          abstractBooleanDecision: { resume: "abstract-boolean", decision, value: false },
        }).done,
      ).toBe(true);
    } finally {
      checkpoint.release();
    }
  });
});

it("prevents the late cache-write and context-stack leak by refusing capture", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent } = fixture;
    const cache = new api.ModuleCache();
    const key = cache.toCacheKey({ Specifier: "file:///delayed.js", Attributes: [] });
    let finish: (() => void) | undefined;
    agent.hostDefinedOptions.hostHooks = {
      HostLoadImportedModule: api.composeModuleLoaders([
        (_referrer, _request, _hostDefined, complete) => {
          cache.load(
            key,
            (setCache) => {
              finish = () => setCache(api.ThrowCompletion(api.Value.undefined));
            },
            complete,
          );
        },
      ]),
    };
    fixture.evaluate('import("file:///delayed.js")');
    if (!finish) throw Error("Expected delayed loader");
    getPause(fixture);
    const depth = agent.executionContextStack.length;
    let checkpoint: EvaluationCheckpoint | undefined;
    let blocked = false,
      ownerCalls = 0,
      cacheHits = 0;
    try {
      checkpoint = agent.captureEvaluation({
        capture: () => {
          ownerCalls++;
          return { restore: () => {} };
        },
      });
    } catch (error) {
      expect(error).toHaveProperty(
        "message",
        "Evaluation checkpoints do not support pending module loads",
      );
      blocked = true;
    }
    if (checkpoint) {
      try {
        expect(finish).toThrow("Host effects are unsupported during evaluation checkpoints");
      } finally {
        checkpoint.release();
      }
      cache.load(
        key,
        () => {},
        () => {
          cacheHits++;
        },
      );
    }
    expect({
      blocked,
      ownerCalls,
      cacheHits,
      contextDelta: agent.executionContextStack.length - depth,
    }).toEqual({ blocked: true, ownerCalls: 0, cacheHits: 0, contextDelta: 0 });
    finish();
    expect(agent.executionContextStack).toHaveLength(depth);
    const saved = getCheckpoint(fixture);
    saved.release();
  });
});

it.each([false, true])(
  "keeps overlapping requests blocked until both finish, reversed=%s",
  async (reversed) => {
    await withAbstractFixture((fixture) => {
      const loads = getPendingLoads(fixture);
      fixture.evaluate('import("file:///same.js"); import("file:///same.js");');
      getPause(fixture);
      expect(loads).toHaveLength(2);
      const order = reversed ? [...loads].reverse() : loads;
      expect(() => getCheckpoint(fixture)).toThrow("pending module loads");
      order[0].finish();
      expect(() => getCheckpoint(fixture)).toThrow("pending module loads");
      order[1].finish();
      const checkpoint = getCheckpoint(fixture);
      checkpoint.release();
    });
  },
);

it("tracks nested graph requests separately despite shared graph-loading state", async () => {
  await withAbstractFixture((fixture) => {
    const { api, realm } = fixture;
    const loads = getPendingLoads(fixture);
    const entry = api.EnsureCompletion(realm.compileModule('import "file:///middle.js";'));
    const middle = api.EnsureCompletion(realm.compileModule('import "file:///leaf.js";'));
    const leaf = api.EnsureCompletion(realm.compileModule("export const value = 1;"));
    if (entry.Type !== "normal" || middle.Type !== "normal" || leaf.Type !== "normal")
      throw Error("Expected modules");
    entry.Value.LoadRequestedModules();
    getPause(fixture);
    expect(() => getCheckpoint(fixture)).toThrow("pending module loads");
    expect(loads.map((load) => load.specifier)).toEqual(["file:///middle.js"]);
    loads[0].finish(middle.Value);
    expect(loads.map((load) => load.specifier)).toEqual(["file:///middle.js", "file:///leaf.js"]);
    expect(loads[0].payload).not.toBe(loads[1].payload);
    const graph = Object.getOwnPropertyDescriptor(loads[0].payload, "data")?.value;
    expect(graph).toBeInstanceOf(api.GraphLoadingState);
    expect(graph).toBe(Object.getOwnPropertyDescriptor(loads[1].payload, "data")?.value);
    expect(() => getCheckpoint(fixture)).toThrow("pending module loads");
    loads[1].finish(leaf.Value);
    const checkpoint = getCheckpoint(fixture);
    checkpoint.release();
  });
});

it.each(["synchronous", "missing"])(
  "does not leave pending state after %s loader completion",
  async (mode) => {
    await withAbstractFixture((fixture) => {
      const { api, agent } = fixture;
      if (mode === "synchronous")
        agent.hostDefinedOptions.hostHooks = {
          HostLoadImportedModule: (referrer, request, _hostDefined, payload) => {
            api.FinishLoadingImportedModule(
              referrer,
              request,
              payload,
              api.ThrowCompletion(api.Value.undefined),
            );
          },
        };
      fixture.evaluate('import("file:///missing.js")');
      getPause(fixture);
      const checkpoint = getCheckpoint(fixture);
      checkpoint.restore();
      checkpoint.release();
    });
  },
);

it("keeps failed loader completion pending instead of granting capture", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent } = fixture;
    let finish: (() => void) | undefined;
    const failure = Error("opaque payload failure");
    agent.hostDefinedOptions.hostHooks = {
      HostLoadImportedModule: (referrer, request, _hostDefined, payload) => {
        Object.defineProperty(payload, "data", {
          get: () => {
            throw failure;
          },
        });
        finish = () =>
          api.FinishLoadingImportedModule(
            referrer,
            request,
            payload,
            api.ThrowCompletion(api.Value.undefined),
          );
      },
    };
    fixture.evaluate('import("file:///delayed.js")');
    getPause(fixture);
    if (!finish) throw Error("Expected loader");
    expect(finish).toThrow(failure);
    expect(() => getCheckpoint(fixture)).toThrow("pending module loads");
  });
});

it("does not let duplicate completion clear a different outstanding request", async () => {
  await withAbstractFixture((fixture) => {
    const loads = getPendingLoads(fixture);
    fixture.evaluate('import("file:///first.js"); import("file:///second.js");');
    getPause(fixture);
    loads[0].finish();
    loads[0].finish();
    expect(() => getCheckpoint(fixture)).toThrow("pending module loads");
    loads[1].finish();
    const checkpoint = getCheckpoint(fixture);
    checkpoint.release();
  });
});

it("scopes pending loads to their Agent", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent } = fixture;
    getPendingLoads(fixture);
    fixture.evaluate('import("file:///delayed.js")');
    getPause(fixture);
    const other = new api.Agent({ startEventLoop: false });
    api.setSurroundingAgent(other);
    try {
      const realm = new api.ManagedRealm();
      realm.pushTopContext();
      api.X(
        api.CreateDataPropertyOrThrow(
          realm.GlobalObject,
          "enabled",
          api.BooleanValue.createAbstract(),
        ),
      );
      const compiled = api.EnsureCompletion(realm.compileScript("if (enabled) void 1;"));
      if (compiled.Type !== "normal") throw Error("Expected script");
      other.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
      const pause = other.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
      expect(pause.done).toBe(false);
      const saved = other.captureEvaluation({ capture: () => ({ restore: () => {} }) });
      saved.restore();
      saved.release();
    } finally {
      other.executionContextStack.length = 0;
      api.setSurroundingAgent(agent);
    }
    expect(() => getCheckpoint(fixture)).toThrow("pending module loads");
  });
});
