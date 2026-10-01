import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { Agent, ContinuationStateOwner } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const getCallbacks = (agent: Agent): Set<() => void> => {
  const callbacks: unknown = Reflect.get(agent, "onNoEvaluator");
  if (!(callbacks instanceof Set)) throw new Error("Expected callbacks");
  return callbacks;
};

const getFailure = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected failure");
};

it.each([false, true])(
  "restores original idle membership and live iteration, trueFirst=%s",
  async (trueFirst) => {
    await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
      createBoolean("enabled");
      const callbacks = getCallbacks(agent);
      const observations: string[] = [];
      let prefixes = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
      };
      let choice = false;
      const added = () => observations.push("added");
      const second = () => observations.push("second");
      const third = () => observations.push("third");
      const first = () => {
        observations.push("first");
        callbacks.delete(first);
        if (choice) {
          callbacks.delete(second);
          callbacks.add(second);
        }
        callbacks.add(added);
      };
      callbacks.add(first);
      callbacks.add(second);
      callbacks.add(third);
      agent.evaluate(
        compile("var prefix=0; prefix++; enabled ? 1 : 2"),
        (completion) => {
          if (!(completion.Value instanceof api.NumberValue)) throw new Error("Expected Number");
          choice = completion.Value.numberValue() === 1;
        },
        false,
      );
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected pause");
      const contexts = [...agent.executionContextStack];
      const saved = agent.captureEvaluation({
        capture: () => ({
          restore: () => {
            agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
          },
        }),
      });
      try {
        for (const decision of trueFirst ? [true, false] : [false, true]) {
          saved.restore();
          expect(getCallbacks(agent) === callbacks).toBe(true);
          observations.length = 0;
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          expect(
            agent.resumeEvaluate({
              abstractBooleanDecision: {
                resume: "abstract-boolean",
                decision: pause.value,
                value: decision,
              },
            }).done,
          ).toBe(true);
          expect(observations).toEqual(
            runInNewContext(
              `
          const observations=[], callbacks=new Set();
          const added=()=>observations.push("added"), second=()=>observations.push("second"), third=()=>observations.push("third");
          const first=()=>{ observations.push("first"); callbacks.delete(first); if(choice){callbacks.delete(second);callbacks.add(second)} callbacks.add(added); };
          callbacks.add(first);callbacks.add(second);callbacks.add(third);
          for(const callback of callbacks) callback();
          observations;
        `,
              { choice: decision },
            ),
          );
          expect(realm.GlobalObject.properties.get("prefix")?.Value).toEqual(api.Value(1));
          expect(prefixes).toBe(1);
        }
      } finally {
        saved.release();
        callbacks.clear();
      }
    });
  },
);

const getOwner = (agent: Agent): ContinuationStateOwner => {
  const contexts = [...agent.executionContextStack];
  return {
    capture: () => ({
      restore: () => {
        agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
      },
    }),
  };
};

it("captures beginCapture additions and restores nested membership with shared LIFO rules", async () => {
  await withAbstractFixture(({ agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const callbacks = getCallbacks(agent);
    const first = () => {},
      second = () => {};
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const owner = getOwner(agent);
    owner.beginCapture = () => callbacks.add(first);
    const outer = agent.captureEvaluation(owner);
    callbacks.add(second);
    const inner = agent.captureEvaluation(getOwner(agent));
    callbacks.clear();
    expect(() => outer.restore()).toThrow("last-in-first-out");
    inner.restore();
    expect([...callbacks]).toEqual([first, second]);
    inner.release();
    outer.restore();
    expect([...callbacks]).toEqual([first]);
    callbacks.clear();
    outer.release();
    expect(callbacks.size).toBe(0);
  });
});

it.each(["references", "metadata", "owner"])(
  "rejects membership changes during %s without publishing an evaluation frame",
  async (phase) => {
    await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
      createBoolean("enabled");
      const callbacks = getCallbacks(agent);
      const added = () => {};
      const first = api.registerNativeClosure(
        () => {},
        () => {
          if (phase === "metadata") callbacks.add(added);
          return { bindings: [], ambientNames: [] };
        },
      );
      callbacks.add(first);
      agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      let captures = 0;
      expect(() =>
        agent.captureEvaluation({
          references: (value) => {
            if (phase === "references" && value === first) callbacks.add(added);
            return [];
          },
          capture: () => {
            captures++;
            if (phase === "owner") callbacks.add(added);
            return { restore: () => {} };
          },
        }),
      ).toThrow("Idle callbacks changed during checkpoint capture");
      expect(captures).toBe(phase === "owner" ? 1 : 0);
      expect(callbacks.has(added)).toBe(true);
      expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
      expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
      callbacks.clear();
      const recovered = agent.captureEvaluation(getOwner(agent));
      recovered.release();
    });
  },
);

it.each(["delete", "reorder"])(
  "rejects %s during discovery even without a size increase",
  async (operation) => {
    await withAbstractFixture(({ agent, compile, createBoolean }) => {
      createBoolean("enabled");
      const callbacks = getCallbacks(agent),
        first = () => {},
        second = () => {};
      callbacks.add(first);
      callbacks.add(second);
      agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
      agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      expect(() =>
        agent.captureEvaluation({
          references: (value) => {
            if (value === second) {
              callbacks.delete(first);
              if (operation === "reorder") callbacks.add(first);
            }
            return [];
          },
          capture: () => {
            throw new Error("Must reject before owner capture");
          },
        }),
      ).toThrow("Idle callbacks changed during checkpoint capture");
      expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
    });
  },
);

it.each(["getter", "iterator", "member"])(
  "rejects invalid %s storage without invoking custom getters",
  async (kind) => {
    await withAbstractFixture(({ agent, compile, createBoolean }) => {
      createBoolean("enabled");
      const callbacks = getCallbacks(agent);
      agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
      agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      let reads = 0;
      if (kind === "getter")
        Object.defineProperty(agent, "onNoEvaluator", {
          configurable: true,
          get: () => {
            reads++;
            return callbacks;
          },
        });
      else if (kind === "iterator")
        Object.defineProperty(callbacks, Symbol.iterator, {
          configurable: true,
          get: () => {
            reads++;
            throw new Error("Must not iterate");
          },
        });
      else Set.prototype.add.call(callbacks, 1);
      try {
        expect(() => agent.captureEvaluation(getOwner(agent))).toThrow(
          kind === "member" ? "function-valued idle notifications" : "canonical idle callback Set",
        );
        expect(reads).toBe(0);
        expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
      } finally {
        Object.defineProperty(agent, "onNoEvaluator", {
          value: callbacks,
          writable: true,
          configurable: true,
        });
        Reflect.deleteProperty(callbacks, Symbol.iterator);
        callbacks.clear();
      }
    });
  },
);

it.each(["replacement", "flags", "own-property", "prototype", "extensibility"])(
  "validates %s before owner restoration and poisons the checkpoint",
  async (kind) => {
    await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
      createBoolean("enabled");
      const callbacks = getCallbacks(agent);
      let bindingRestores = 0;
      const callback = api.registerNativeClosure(
        () => {},
        () => ({
          bindings: [
            {
              name: "counter",
              get: () => 0,
              set: () => {
                bindingRestores++;
              },
            },
          ],
          ambientNames: [],
        }),
      );
      callbacks.add(callback);
      agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
      agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      let restores = 0;
      const saved = agent.captureEvaluation({
        capture: () => ({
          restore: () => {
            restores++;
          },
        }),
      });
      if (kind === "replacement")
        Object.defineProperty(agent, "onNoEvaluator", { value: new Set() });
      else if (kind === "flags")
        Object.defineProperty(agent, "onNoEvaluator", { enumerable: false });
      else if (kind === "own-property")
        Object.defineProperty(callbacks, "extra", { value: 1, configurable: true });
      else if (kind === "prototype") Object.setPrototypeOf(callbacks, null);
      else Object.preventExtensions(callbacks);
      try {
        const failure = getFailure(() => saved.restore());
        expect(failure).toBeInstanceOf(TypeError);
        expect([restores, bindingRestores]).toEqual([0, 0]);
        Object.defineProperty(agent, "onNoEvaluator", { value: callbacks, enumerable: true });
        Reflect.deleteProperty(callbacks, "extra");
        Object.setPrototypeOf(callbacks, Set.prototype);
        expect(getFailure(() => saved.restore())).toBe(failure);
        expect(getFailure(() => agent.resumeEvaluate())).toBe(failure);
      } finally {
        Object.defineProperty(agent, "onNoEvaluator", { value: callbacks, enumerable: true });
        Reflect.deleteProperty(callbacks, "extra");
        Object.setPrototypeOf(callbacks, Set.prototype);
        saved.release();
      }
    });
  },
);

it("detects replacement by owner.restore and preserves the exact failure", async () => {
  await withAbstractFixture(({ agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const callbacks = getCallbacks(agent);
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    let restores = 0;
    const saved = agent.captureEvaluation({
      capture: () => ({
        restore: () => {
          restores++;
          Object.defineProperty(agent, "onNoEvaluator", { value: new Set() });
        },
      }),
    });
    const failure = getFailure(() => saved.restore());
    expect(failure).toBeInstanceOf(TypeError);
    Object.defineProperty(agent, "onNoEvaluator", { value: callbacks });
    expect(getFailure(() => saved.restore())).toBe(failure);
    expect(restores).toBe(1);
    saved.release();
  });
});

it("keeps removed saved callback captures alive until evaluation checkpoint release", async () => {
  await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
    createBoolean("enabled");
    const target = evaluate(
      "var target=Object.create(null); var weak=new WeakRef(target); target",
    ).Value;
    const weak = realm.GlobalObject.properties.get("weak")?.Value;
    if (!(weak instanceof api.ObjectValue)) throw new Error("Expected weak reference");
    const callbacks = getCallbacks(agent);
    const callback = api.registerNativeClosure(
      () => {
        callbacks.delete(callback);
      },
      () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
    );
    evaluate("target=undefined");
    callbacks.add(callback);
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected pause");
    const saved = agent.captureEvaluation(getOwner(agent));
    agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: true },
    });
    expect(callbacks.has(callback)).toBe(false);
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(true);
    saved.release();
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(false);
  });
});

it("does not turn membership restoration into callback-referent ownership", async () => {
  await withAbstractFixture(({ agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const state = { calls: 0 },
      callbacks = getCallbacks(agent);
    const callback = () => {
      state.calls++;
      callbacks.delete(callback);
    };
    callbacks.add(callback);
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected pause");
    const saved = agent.captureEvaluation(getOwner(agent));
    try {
      for (const decision of [true, false]) {
        saved.restore();
        agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: decision,
          },
        });
      }
      expect(state.calls).toBe(2);
    } finally {
      saved.release();
    }
  });
});

it.each(
  ["references", "owner"].flatMap((phase) =>
    ["replacement", "flags"].map((kind) => ({ phase, kind })),
  ),
)("rejects $kind during $phase before publication", async ({ phase, kind }) => {
  await withAbstractFixture(({ agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const callbacks = getCallbacks(agent),
      callback = () => {};
    callbacks.add(callback);
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const mutate = () =>
      Object.defineProperty(
        agent,
        "onNoEvaluator",
        kind === "replacement" ? { value: new Set() } : { writable: false },
      );
    let captures = 0;
    try {
      expect(() =>
        agent.captureEvaluation({
          references: (value) => {
            if (phase === "references" && value === callback) mutate();
            return [];
          },
          capture: () => {
            captures++;
            if (phase === "owner") mutate();
            return { restore: () => {} };
          },
        }),
      ).toThrow("idle callback metadata changed");
      expect(captures).toBe(phase === "owner" ? 1 : 0);
      expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
      expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
    } finally {
      Object.defineProperty(agent, "onNoEvaluator", { value: callbacks, writable: true });
    }
    const saved = agent.captureEvaluation(getOwner(agent));
    saved.release();
  });
});

it.each(["references", "owner"])(
  "preserves a throwing %s hook without rolling back its mutation",
  async (phase) => {
    await withAbstractFixture(({ agent, compile, createBoolean }) => {
      createBoolean("enabled");
      const callbacks = getCallbacks(agent),
        callback = () => {},
        added = () => {};
      callbacks.add(callback);
      const failure = new Error("Hook failed after mutation");
      const mutate = () => {
        callbacks.add(added);
        throw failure;
      };
      agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      expect(
        getFailure(() =>
          agent.captureEvaluation({
            references: (value) => {
              if (phase === "references" && value === callback) mutate();
              return [];
            },
            capture: () => mutate(),
          }),
        ),
      ).toBe(failure);
      expect(callbacks.has(added)).toBe(true);
      expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
      expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
      callbacks.delete(added);
      const saved = agent.captureEvaluation(getOwner(agent));
      saved.release();
    });
  },
);

it("restores membership after owner.restore, without authorizing host effects", async () => {
  await withAbstractFixture(({ agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const callbacks = getCallbacks(agent),
      first = () => {},
      second = () => {},
      added = () => {};
    callbacks.add(first);
    callbacks.add(second);
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const saved = agent.captureEvaluation({
      capture: () => ({
        restore: () => {
          callbacks.clear();
          callbacks.add(added);
          callbacks.add(second);
          callbacks.add(first);
        },
      }),
    });
    try {
      saved.restore();
      expect([...callbacks]).toEqual([first, second]);
      expect(() => agent.assertCanPerformHostEffect()).toThrow(
        "Host effects are unsupported during evaluation checkpoints",
      );
    } finally {
      saved.release();
    }
  });
});

it("snapshots membership of a frozen native Set rather than treating it as immutable", async () => {
  await withAbstractFixture(({ agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const callbacks = getCallbacks(agent),
      callback = () => {};
    callbacks.add(callback);
    Object.freeze(callbacks);
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const saved = agent.captureEvaluation(getOwner(agent));
    try {
      callbacks.clear();
      saved.restore();
      expect([...callbacks]).toEqual([callback]);
    } finally {
      saved.release();
    }
  });
});
