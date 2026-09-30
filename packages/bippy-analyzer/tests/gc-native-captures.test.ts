import { expect, it } from "vite-plus/test";
import type { Value, NativeSteps } from "../engine/dist/declaration/index.mjs";
import { createConcreteRuntime, type ConcreteRuntime } from "../src/concrete/runtime.js";
import { getSymbolicEngine, type SymbolicEngine } from "../src/symbolic/load-engine.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface NativeRootFixture {
  api: SymbolicEngine["api"];
  runtime: ConcreteRuntime;
  target: Value;
  collect: () => void;
  observe: () => string;
  install: (callback: OmitThisParameter<NativeSteps>) => void;
}

const withNativeRoots = async (run: (fixture: NativeRootFixture) => void) => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(runtime.agent);
  const pop = runtime.realm.pushTopContext();
  try {
    const target = runtime.evaluate("var target = {}; var reference = new WeakRef(target); target");
    run({
      api,
      runtime,
      target,
      collect: () => {
        runtime.agent.AgentRecord.KeptAlive.clear();
        api.gc();
      },
      observe: () => runtime.readString("String(reference.deref() !== undefined)"),
      install: (callback) => {
        api.X(
          api.CreateDataPropertyOrThrow(
            runtime.realm.GlobalObject,
            "retained",
            api.CreateBuiltinFunction(callback, 0, "retained", []),
          ),
        );
        runtime.evaluate("target = null");
      },
    });
  } finally {
    pop?.();
    api.setSurroundingAgent(previous);
    runtime.dispose();
  }
};

it("follows declared captures through from adapters and drops removed roots", async () => {
  await withNativeRoots(({ api, runtime, target, collect, observe }) => {
    const steps = api.registerNativeClosure(
      () => target,
      () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
    );
    const native = getNativeGcObservation(
      `
      globalThis.retained = (() => {
        const target = {};
        globalThis.reference = new WeakRef(target);
        const steps = () => target;
        return Reflect.apply.bind(null, steps, null);
      })();
    `,
      "String(reference.deref() !== undefined)",
    );
    expect(native).toBe("true");
    const builtin = api.CreateBuiltinFunction.from(steps);
    api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "retained", builtin));
    runtime.evaluate("target = null");
    collect();
    expect(observe()).toBe("true");
    runtime.evaluate("retained = null");
    collect();
    expect(observe()).toBe("false");
  });
});

it("handles mutual native cycles and reads each manifest once per collection", async () => {
  await withNativeRoots(({ api, runtime, target, install, collect, observe }) => {
    let firstReads = 0;
    let secondReads = 0;
    const first = () => second();
    const second = (): Value => target;
    api.registerNativeClosure(first, () => {
      firstReads++;
      return { bindings: [{ name: "second", get: () => second }], ambientNames: [] };
    });
    api.registerNativeClosure(second, () => {
      secondReads++;
      return {
        bindings: [
          { name: "first", get: () => first },
          { name: "target", get: () => target },
        ],
        ambientNames: [],
      };
    });
    install(first);
    collect();
    expect(observe()).toBe("true");
    expect([firstReads, secondReads]).toEqual([1, 1]);
    collect();
    expect([firstReads, secondReads]).toEqual([2, 2]);
    runtime.evaluate("retained = null");
    collect();
    expect(observe()).toBe("false");
    expect([firstReads, secondReads]).toEqual([2, 2]);
  });
});

it("reads current binding values rather than caching old references", async () => {
  await withNativeRoots(({ api, target, install, collect, observe }) => {
    let current = target;
    install(
      api.registerNativeClosure(
        () => current,
        () => ({ bindings: [{ name: "current", get: () => current }], ambientNames: [] }),
      ),
    );
    collect();
    expect(observe()).toBe("true");
    current = api.Value.undefined;
    collect();
    const native = getNativeGcObservation(
      `
      globalThis.retained = (() => {
        let current = {};
        globalThis.reference = new WeakRef(current);
        const callback = () => current;
        current = undefined;
        return callback;
      })();
    `,
      "String(reference.deref() !== undefined)",
    );
    expect(observe()).toBe(native);
    expect(native).toBe("false");
  });
});

it.each(["microtask", "macrotask"])(
  "marks %s job captures without a duplicate capturedValues declaration",
  async (kind) => {
    await withNativeRoots(({ api, runtime, target, collect, observe }) => {
      const job = {
        queueName: "Native captures",
        callerRealm: runtime.realm,
        callerScriptOrModule: null,
        job: api.registerNativeClosure(
          () => api.GetValue(target),
          () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
        ),
      };
      if (kind === "microtask") runtime.agent.jobQueue.enqueueGenericJob(job);
      else runtime.agent.eventLoop.enqueue("timers", job);
      runtime.evaluate("target = null");
      collect();
      expect(observe()).toBe("true");
      const contexts = runtime.agent.executionContextStack.splice(0);
      try {
        runtime.drainJobs();
        expect(runtime.agent.jobQueue.length).toBe(0);
        expect(
          Object.getOwnPropertyDescriptor(runtime.agent.eventLoop, "queuedJobs")?.value.size,
        ).toBe(0);
      } finally {
        runtime.agent.executionContextStack.push(...contexts);
      }
      collect();
      expect(observe()).toBe("false");
    });
  },
);

it("roots selected builtin snapshots until release", async () => {
  await withNativeRoots(({ api, runtime, target, install, collect, observe }) => {
    install(
      api.registerNativeClosure(
        () => target,
        () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
      ),
    );
    const builtin = runtime.evaluate("retained");
    if (!(builtin instanceof api.ObjectValue)) throw Error("Expected builtin");
    const snapshot = api.createStateCheckpoint({ objects: [builtin] });
    runtime.evaluate("retained = null");
    collect();
    expect(observe()).toBe("true");
    snapshot.release();
    collect();
    expect(observe()).toBe("false");
  });
});

it("feeds native capture edges back into the existing ephemeron fixed point", async () => {
  await withNativeRoots(({ api, runtime, install, collect, observe }) => {
    const key = runtime.evaluate("var key = {}, anchor = {}; key");
    install(
      api.registerNativeClosure(
        () => key,
        () => ({ bindings: [{ name: "key", get: () => key }], ambientNames: [] }),
      ),
    );
    runtime.evaluate("target = reference.deref()");
    runtime.evaluate(`
      var innerMap = new WeakMap([[key, target]]);
      var outerMap = new WeakMap([[anchor, retained]]);
      key = target = retained = null;
    `);
    collect();
    expect(observe()).toBe("true");
    const native = getNativeGcObservation(
      `
      globalThis.anchor = {};
      (() => {
        const key = {}, target = {};
        globalThis.reference = new WeakRef(target);
        globalThis.innerMap = new WeakMap([[key, target]]);
        globalThis.outerMap = new WeakMap([[anchor, () => key]]);
      })();
    `,
      "String(reference.deref() !== undefined)",
    );
    expect(observe()).toBe(native);
    expect(native).toBe("true");
    runtime.evaluate("anchor = null");
    collect();
    expect(observe()).toBe("false");
  });
});

it("does not root a dead WeakMap cycle through a registered value callback", async () => {
  await withNativeRoots(({ api, runtime, target, install, collect, observe }) => {
    let reads = 0;
    install(
      api.registerNativeClosure(
        () => target,
        () => {
          reads++;
          return { bindings: [{ name: "target", get: () => target }], ambientNames: [] };
        },
      ),
    );
    runtime.evaluate("target = reference.deref()");
    runtime.evaluate("var map = new WeakMap([[target, retained]]); target = retained = null");
    collect();
    expect(observe()).toBe("false");
    expect(reads).toBe(0);
  });
});

it.each(["unregistered", "plain-record"])(
  "keeps %s captures outside automatic traversal",
  async (kind) => {
    await withNativeRoots(({ api, target, install, collect, observe }) => {
      const record = { target };
      const callback = () => record.target;
      if (kind === "plain-record")
        api.registerNativeClosure(callback, () => ({
          bindings: [{ name: "record", get: () => record }],
          ambientNames: [],
        }));
      Object.defineProperty(callback, "mark", {
        get: () => {
          throw Error("Function properties must not be inspected");
        },
      });
      install(callback);
      collect();
      expect(observe()).toBe("false");
    });
  },
);

it("propagates a capture getter failure before clearing weak targets", async () => {
  await withNativeRoots(({ api, runtime, install, collect, observe }) => {
    const failure = Error("capture getter failed");
    install(
      api.registerNativeClosure(
        () => api.Value.undefined,
        () => ({
          bindings: [
            {
              name: "target",
              get: () => {
                throw failure;
              },
            },
          ],
          ambientNames: [],
        }),
      ),
    );
    let caught: unknown;
    try {
      collect();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(observe()).toBe("true");
    runtime.evaluate("retained = null");
    collect();
    expect(observe()).toBe("false");
  });
});

it("does not swallow native TDZ failures or sweep after them", async () => {
  await withNativeRoots(({ api, target, install, collect, observe }) => {
    install(
      api.registerNativeClosure(
        () => api.Value.undefined,
        () => ({ bindings: [{ name: "late", get: () => late }], ambientNames: [] }),
      ),
    );
    expect(collect).toThrow(ReferenceError);
    expect(observe()).toBe("true");
    const late = target;
    collect();
    expect(observe()).toBe("true");
  });
});
