import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { Agent, StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const getIdleCallbacks = (agent: Agent): Set<() => void> => {
  const callbacks: unknown = Reflect.get(agent, "onNoEvaluator");
  if (!(callbacks instanceof Set)) throw new Error("Expected idle callback Set");
  return callbacks;
};

it.each(
  [false, true].flatMap((isReversed) => ["finish", "idle"].map((kind) => ({ isReversed, kind }))),
)("restores transitive $kind bindings, reversed=$isReversed", async ({ isReversed, kind }) => {
  await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
    createBoolean("enabled");
    let calls = 0;
    let prefixes = 0;
    const increment = api.registerNativeClosure(
      () => {
        calls++;
      },
      () => ({
        bindings: [
          {
            name: "calls",
            get: () => calls,
            set: (value) => {
              if (typeof value !== "number") throw new Error("Expected counter");
              calls = value;
            },
          },
        ],
        ambientNames: [],
      }),
    );
    const callback = api.registerNativeClosure(
      () => increment(),
      () => ({
        bindings: [{ name: "increment", get: () => increment }],
        ambientNames: [],
      }),
    );
    if (kind === "idle") getIdleCallbacks(agent).add(callback);
    const source = "var prefix = 0; prefix++; enabled ? 11 : 22;";
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
    };
    agent.evaluate(compile(source), kind === "finish" ? callback : () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected decision");
    let heap: StateCheckpoint | undefined;
    let hasTransitiveCapture = false;
    const checkpoint = agent.captureEvaluation({
      capture: (roots) => {
        expect(roots.values.includes(callback)).toBe(true);
        hasTransitiveCapture = roots.values.includes(increment);
        const contexts = [...agent.executionContextStack];
        const saved = (heap = api.createStateCheckpoint({
          objects: [realm.GlobalObject],
          environments: [realm.GlobalEnv.DeclarativeRecord],
          contexts,
        }));
        return {
          restore: () => {
            saved.restore();
            agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
          },
        };
      },
    });
    try {
      for (const choice of isReversed ? [true, false] : [false, true]) {
        checkpoint.restore();
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
        const result = agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: choice,
          },
        });
        if (!result.done) throw new Error("Expected completion");
        const completion = api.EnsureCompletion(result.value);
        if (!(completion.Value instanceof api.NumberValue)) throw new Error("Expected Number");
        expect([completion.Value.numberValue(), calls]).toEqual(
          runInNewContext(
            `let calls = 0; const callback = () => {calls++}; const result = enabled ? 11 : 22; callback(); [result,calls]`,
            { enabled: choice },
          ),
        );
      }
      expect(prefixes).toBe(1);
      expect(hasTransitiveCapture).toBe(true);
    } finally {
      checkpoint.release();
      heap?.release();
      getIdleCallbacks(agent).delete(callback);
    }
  });
});

it.each(["finish", "idle"])(
  "rejects an unowned %s dependency before publishing a checkpoint",
  async (kind) => {
    await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
      createBoolean("enabled");
      const dependency = { calls: 0 };
      const callback = api.registerNativeClosure(
        () => {
          dependency.calls++;
        },
        () => ({ bindings: [{ name: "dependency", get: () => dependency }], ambientNames: [] }),
      );
      if (kind === "idle") getIdleCallbacks(agent).add(callback);
      agent.evaluate(compile("enabled ? 1 : 2"), kind === "finish" ? callback : () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected decision");
      let captures = 0;
      const failure = new Error("Unowned callback dependency");
      expect(() =>
        agent.captureEvaluation({
          references: (value) => {
            if (value === dependency) throw failure;
            return [];
          },
          capture: () => {
            captures++;
            return { restore: () => {} };
          },
        }),
      ).toThrow(failure);
      expect(captures).toBe(0);
      expect(agent.resumeEvaluate().value === pause.value).toBe(true);
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: true },
      });
      expect(dependency.calls).toBe(1);
      getIdleCallbacks(agent).delete(callback);
      agent.evaluate(compile("3"), () => {}, false);
      expect(agent.resumeEvaluate().done).toBe(true);
    });
  },
);

it.each([false, true])(
  "keeps registration a declaration, not transitive storage ownership, registered=%s",
  async (registered) => {
    await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
      createBoolean("enabled");
      const state = { calls: 0 };
      const callback = () => {
        state.calls++;
      };
      if (registered)
        api.registerNativeClosure(callback, () => ({
          bindings: [{ name: "state", get: () => state }],
          ambientNames: [],
        }));
      agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      const checkpoint = agent.captureEvaluation({
        capture: () => ({
          restore: () => {
            agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
          },
        }),
      });
      try {
        for (const choice of [false, true]) {
          checkpoint.restore();
          agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: choice,
            },
          });
        }
        expect(state.calls).toBe(2);
      } finally {
        checkpoint.release();
      }
    });
  },
);

it("preserves callback-getter failure and leaves the pending decision usable", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const failure = new Error("Callback getter failed");
    let captures = 0;
    const callback = api.registerNativeClosure(
      () => {},
      () => ({
        bindings: [
          {
            name: "failed",
            get: () => {
              throw failure;
            },
          },
        ],
        ambientNames: [],
      }),
    );
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected decision");
    expect(() =>
      agent.captureEvaluation({
        capture: () => {
          captures++;
          return { restore: () => {} };
        },
      }),
    ).toThrow(failure);
    expect(captures).toBe(0);
    expect(agent.resumeEvaluate().value === pause.value).toBe(true);
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: true },
      }).done,
    ).toBe(true);
  });
});

it("validates read-only callback captures before restoring owner storage", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    let binding = 1;
    let restores = 0;
    const callback = api.registerNativeClosure(
      () => {},
      () => ({ bindings: [{ name: "notificationBinding", get: () => binding }], ambientNames: [] }),
    );
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const checkpoint = agent.captureEvaluation({
      capture: () => ({
        restore: () => {
          restores++;
        },
      }),
    });
    binding = 2;
    try {
      expect(() => checkpoint.restore()).toThrow("Read-only capture changed: notificationBinding");
      expect(restores).toBe(0);
    } finally {
      checkpoint.release();
    }
  });
});

it.each(["finish", "idle"])(
  "roots the saved %s binding value after the callback replaces it",
  async (kind) => {
    await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
      createBoolean("enabled");
      let held = evaluate("var target = {}; var reference = new WeakRef(target); target").Value;
      evaluate("target = null");
      const empty = api.Value.undefined;
      const callback = api.registerNativeClosure(
        () => {
          held = empty;
        },
        () => ({
          bindings: [
            {
              name: "held",
              get: () => held,
              set: (value) => {
                if (!(value instanceof api.ObjectValue)) throw new Error("Expected saved object");
                held = value;
              },
            },
            { name: "empty", get: () => empty },
          ],
          ambientNames: [],
        }),
      );
      if (kind === "idle") getIdleCallbacks(agent).add(callback);
      agent.evaluate(compile("enabled ? 1 : 2"), kind === "finish" ? callback : () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected decision");
      const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
      try {
        agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: true,
          },
        });
        expect(held === empty).toBe(true);
        const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
        if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
        expect(reference.WeakRefTarget !== undefined).toBe(true);
      } finally {
        checkpoint.release();
        getIdleCallbacks(agent).delete(callback);
      }
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
      if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
      expect(reference.WeakRefTarget === undefined).toBe(true);
    });
  },
);

it("guards additional-root discovery against reentry and recovers from its failure", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const iterator = compile("enabled ? 1 : 2");
    agent.evaluate(iterator, () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected decision");
    let captures = 0;
    let began = false;
    const owner = {
      beginCapture: () => {
        began = true;
      },
      capture: () => {
        captures++;
        return { restore: () => {} };
      },
    };
    const failure = new Error("Additional root discovery failed");
    expect(() =>
      api.captureControl(iterator, owner, () => {
        expect(began).toBe(true);
        expect(() => iterator.next()).toThrow("Cannot resume during a control checkpoint");
        expect(() => api.captureControl(iterator, owner)).toThrow("another checkpoint");
        throw failure;
      }),
    ).toThrow(failure);
    expect(captures).toBe(0);
    expect(agent.resumeEvaluate().value === pause.value).toBe(true);
    const checkpoint = agent.captureEvaluation(owner);
    checkpoint.release();
    expect(captures).toBe(1);
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: true },
      }).done,
    ).toBe(true);
  });
});

it("includes callbacks installed by beginCapture and deduplicates cyclic captures", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    let reads = 0;
    const callback = () => {};
    api.registerNativeClosure(callback, () => {
      reads++;
      return {
        bindings: [{ name: "self", get: () => callback }],
        ambientNames: ["callbackAmbient"],
      };
    });
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const checkpoint = agent.captureEvaluation({
      beginCapture: () => {
        getIdleCallbacks(agent).add(callback);
      },
      capture: (roots) => {
        expect(roots.values.includes(callback)).toBe(true);
        expect(roots.ambientNames).toContain("callbackAmbient");
        expect(reads).toBe(1);
        return { restore: () => {} };
      },
    });
    checkpoint.release();
    getIdleCallbacks(agent).delete(callback);
  });
});
