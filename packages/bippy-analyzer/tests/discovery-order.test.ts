import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { Agent, ContinuationStateOwner } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const getIdleCallbacks = (agent: Agent): Set<() => void> => {
  const callbacks: unknown = Reflect.get(agent, "onNoEvaluator");
  if (!(callbacks instanceof Set)) throw new Error("Expected callbacks");
  return callbacks;
};

it.each(["finish", "idle", "scoped", "transitive"])(
  "rejects %s metadata before executing its factory or getters",
  async (kind) => {
    await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
      createBoolean("enabled");
      let factories = 0,
        fields = 0,
        getters = 0,
        notifications = 0,
        captures = 0;
      const callback = api.registerNativeClosure(
        () => {
          notifications++;
        },
        () => {
          factories++;
          return {
            get bindings() {
              fields++;
              return [
                {
                  name: "hidden",
                  get: () => {
                    getters++;
                    return 7;
                  },
                },
              ];
            },
            ambientNames: [],
          };
        },
      );
      const parent = api.registerNativeClosure(
        () => {},
        () => ({ bindings: [{ name: "child", get: () => callback }], ambientNames: [] }),
      );
      if (kind === "idle") getIdleCallbacks(agent).add(callback);
      agent.evaluate(compile("enabled ? 1 : 2"), kind === "finish" ? callback : () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected pause");
      const failure = new Error("Unadmitted native declaration");
      let caught: unknown;
      try {
        agent.withGCRoots(
          kind === "scoped" ? [callback] : kind === "transitive" ? [parent] : [],
          () => {
            agent.captureEvaluation({
              references: (value) => {
                if (value === callback && api.getNativeSourceModule(value) === undefined)
                  throw failure;
                return [];
              },
              capture: () => {
                captures++;
                return { restore: () => {} };
              },
            });
          },
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      expect([factories, fields, getters, captures, notifications]).toEqual([0, 0, 0, 0, 0]);
      expect(agent.resumeEvaluate().value).toBe(pause.value);
      expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
      getIdleCallbacks(agent).delete(callback);
      expect(
        agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: true,
          },
        }).done,
      ).toBe(true);
    });
  },
);

it("rejects publicly replaced engine metadata before its factory executes", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const candidate = agent.assertCanPerformHostEffect;
    expect(api.getNativeSourceModule(candidate)).toBeDefined();
    let factories = 0;
    api.registerNativeClosure(candidate, () => {
      factories++;
      return { bindings: [], ambientNames: [] };
    });
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const failure = new Error("Revoked native provenance");
    let caught: unknown;
    try {
      agent.withGCRoots([candidate], () =>
        agent.captureEvaluation({
          references: (value) => {
            if (value === candidate && !api.getNativeSourceModule(value)) throw failure;
            return [];
          },
          capture: () => ({ restore: () => {} }),
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(factories).toBe(0);
    expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it("iterates and roots owner references before expanding native metadata", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const trace: string[] = [];
    const dependency = {};
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        trace.push("factory");
        return {
          bindings: [
            {
              name: "self",
              get: (): unknown => {
                trace.push("binding");
                return callback;
              },
            },
          ],
          ambientNames: [],
        };
      },
    );
    const references: unknown[] = [dependency];
    const iterator = references[Symbol.iterator].bind(references);
    references[Symbol.iterator] = () => {
      trace.push("iterate");
      return iterator();
    };
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const owner: ContinuationStateOwner = {
      references: (value) => {
        if (value !== callback) return [];
        trace.push("references");
        return references;
      },
      capture: (roots) => {
        expect(roots.values.includes(dependency)).toBe(true);
        return { restore: () => {} };
      },
    };
    agent.withGCRoots([callback, callback], () => {
      const saved = agent.captureEvaluation(owner);
      saved.release();
    });
    expect(trace).toEqual(["references", "iterate", "factory", "binding"]);
  });
});

it("does not expand metadata if the owner reference iterator throws", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    let factories = 0;
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        factories++;
        return { bindings: [], ambientNames: [] };
      },
    );
    const failure = new Error("Reference iterator failed");
    const references: unknown[] = [];
    references[Symbol.iterator] = () => {
      throw failure;
    };
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    let caught: unknown;
    try {
      agent.captureEvaluation({
        references: (value) => (value === callback ? references : []),
        capture: () => ({ restore: () => {} }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(factories).toBe(0);
    const recovered = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    recovered.release();
    expect(factories).toBe(1);
  });
});

it("retains original owner-edge priority without claiming whole-graph preflight", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const trace: string[] = [];
    const ownerChild = {};
    const metadataChild = api.registerNativeClosure(
      () => {},
      () => {
        trace.push("child-factory");
        return { bindings: [], ambientNames: [] };
      },
    );
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        trace.push("parent-factory");
        return { bindings: [{ name: "child", get: () => metadataChild }], ambientNames: [] };
      },
    );
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const failure = new Error("Unowned descendant");
    let caught: unknown;
    try {
      agent.captureEvaluation({
        references: (value) => {
          if (value === callback) {
            trace.push("parent-references");
            return [ownerChild];
          }
          if (value === ownerChild) {
            trace.push("child-rejection");
            throw failure;
          }
          return [];
        },
        capture: () => ({ restore: () => {} }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(trace).toEqual(["parent-references", "parent-factory", "child-rejection"]);
  });
});

it("releases partially discovered references when a later iterator next throws", async () => {
  await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
    createBoolean("enabled");
    const target = evaluate("var target = {}; var weak = new WeakRef(target); target").Value;
    const weak = realm.GlobalObject.properties.get("weak")?.Value;
    if (!(weak instanceof api.ObjectValue)) throw new Error("Expected WeakRef");
    evaluate("target = undefined");
    let factories = 0,
      nextCalls = 0;
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        factories++;
        return { bindings: [], ambientNames: [] };
      },
    );
    const failure = new Error("Later iterator next failed");
    const references: unknown[] = [target];
    const iterator = references.values();
    const next = iterator.next.bind(iterator);
    iterator.next = () => {
      if (nextCalls++ === 0) return next();
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(true);
      throw failure;
    };
    references[Symbol.iterator] = () => iterator;
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    let caught: unknown;
    try {
      agent.captureEvaluation({
        references: (value) => (value === callback ? references : []),
        capture: () => ({ restore: () => {} }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(nextCalls).toBe(2);
    expect(factories).toBe(1);
    expect(agent.resumeEvaluate().value).toBe(pause.value);
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(false);
  });
});

it("expands metadata registered by the owner's current reference inspection", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    let oldFactories = 0,
      newFactories = 0;
    const before = {},
      after = {};
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        oldFactories++;
        return { bindings: [{ name: "before", get: () => before }], ambientNames: [] };
      },
    );
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const saved = agent.captureEvaluation({
      references: (value) => {
        if (value === callback)
          api.registerNativeClosure(callback, () => {
            newFactories++;
            return { bindings: [{ name: "after", get: () => after }], ambientNames: [] };
          });
        return [];
      },
      capture: (roots) => {
        expect(roots.values.includes(after)).toBe(true);
        expect(roots.values.includes(before)).toBe(false);
        return { restore: () => {} };
      },
    });
    saved.release();
    expect([oldFactories, newFactories]).toEqual([0, 1]);
  });
});

it("retains owner-provided values through collection in a later metadata factory", async () => {
  await withAbstractFixture(({ api, agent, realm, compile, evaluate, createBoolean }) => {
    createBoolean("enabled");
    const target = evaluate("var target = {}; var weak = new WeakRef(target); target").Value;
    const weak = realm.GlobalObject.properties.get("weak")?.Value;
    if (!(target instanceof api.ObjectValue) || !(weak instanceof api.ObjectValue))
      throw new Error("Expected objects");
    evaluate("target = undefined");
    let held: unknown = target;
    let collected = false;
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        if (!collected) {
          collected = true;
          held = undefined;
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
        }
        return { bindings: [], ambientNames: [] };
      },
    );
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected pause");
    const saved = agent.captureEvaluation({
      references: (value) => (value === callback ? [held] : []),
      capture: (roots) => {
        expect(roots.values.includes(target)).toBe(true);
        return { restore: () => {} };
      },
    });
    try {
      expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(true);
    } finally {
      saved.release();
    }
    agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: false },
    });
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(false);
  });
});

it("does not treat discovery rejection as a gate on GC metadata access", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    let factories = 0;
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        factories++;
        return { bindings: [], ambientNames: [] };
      },
    );
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const failure = new Error("Unowned callback");
    let caught: unknown;
    try {
      agent.captureEvaluation({
        beginCapture: () => {
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
        },
        references: (value) => {
          if (value === callback) throw failure;
          return [];
        },
        capture: () => ({ restore: () => {} }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(factories).toBeGreaterThan(0);
  });
});

it("keeps host-effect rejection active during reference inspection", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    let factories = 0;
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        factories++;
        return { bindings: [], ambientNames: [] };
      },
    );
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    expect(() =>
      agent.captureEvaluation({
        references: (value) => {
          if (value === callback) agent.assertCanPerformHostEffect();
          return [];
        },
        capture: () => ({ restore: () => {} }),
      }),
    ).toThrow("Host effects are unsupported during evaluation checkpoints");
    expect(factories).toBe(0);
    expect(agent.resumeEvaluate().value).toBe(pause.value);
    expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it.each([false, true])(
  "retains binding restoration with one prefix, trueFirst=%s",
  async (trueFirst) => {
    await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
      createBoolean("enabled");
      let calls = 0,
        prefixes = 0,
        inspections = 0;
      const callback = api.registerNativeClosure(
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
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
      };
      const source = "var prefix = 0; prefix++; enabled ? 11 : 22";
      agent.evaluate(compile(source), callback, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected pause");
      const contexts = [...agent.executionContextStack];
      const saved = agent.captureEvaluation({
        references: (value) => {
          if (value === callback) inspections++;
          return [];
        },
        capture: () => ({
          restore: () => {
            agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
          },
        }),
      });
      try {
        for (const choice of trueFirst ? [true, false] : [false, true]) {
          saved.restore();
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
            runInNewContext("let calls=0; const result=enabled?11:22; calls++; [result,calls]", {
              enabled: choice,
            }),
          );
        }
        expect([prefixes, inspections]).toEqual([1, 1]);
      } finally {
        saved.release();
      }
    });
  },
);

it("keeps omitted reference inspection caller-owned, not fail-closed", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    let factories = 0;
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        factories++;
        return { bindings: [], ambientNames: [] };
      },
    );
    agent.evaluate(compile("enabled ? 1 : 2"), callback, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const saved = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    saved.release();
    expect(factories).toBe(1);
  });
});
