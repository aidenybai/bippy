import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { Value } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface NotificationFixture extends AbstractFixture {
  target: Value;
  callbacks: Set<() => void>;
  collect: () => void;
  isAlive: () => boolean;
}

const withNotifications = async (run: (fixture: NotificationFixture) => void) => {
  await withAbstractFixture((fixture) => {
    const { api, agent, realm, evaluate } = fixture;
    const target = evaluate("var target = {}; var reference = new WeakRef(target); target").Value;
    evaluate("target = null");
    const callbacks: unknown = Reflect.get(agent, "onNoEvaluator");
    if (!(callbacks instanceof Set)) throw new Error("Expected idle callbacks");
    const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
    if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
    run({
      ...fixture,
      target,
      callbacks,
      collect: () => {
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
      },
      isAlive: () => reference.WeakRefTarget !== undefined,
    });
  });
};

it.each(["finish", "idle"])(
  "retains a declared %s callback while registered, then releases its target",
  async (kind) => {
    await withNotifications(
      ({ api, agent, compile, createBoolean, target, callbacks, collect, isAlive }) => {
        createBoolean("enabled");
        const callback = api.registerNativeClosure(
          () => {
            void target;
          },
          () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
        );
        if (kind === "idle") callbacks.add(callback);
        agent.evaluate(compile("enabled ? 1 : 2"), kind === "finish" ? callback : () => {}, false);
        collect();
        expect(isAlive()).toBe(true);
        const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
        if (pause.done || !pause.value) throw new Error("Expected decision");
        collect();
        expect(isAlive()).toBe(true);
        agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: true,
          },
        });
        callbacks.delete(callback);
        collect();
        expect(isAlive()).toBe(false);
      },
    );
    expect(
      getNativeGcObservation(
        `globalThis.callback = (()=>{const target = {};globalThis.reference=new WeakRef(target);return ()=>target})()`,
        "String(reference.deref() !== undefined)",
      ),
    ).toBe("true");
  },
);

it("reads current callback bindings rather than pinning the registration-time value", async () => {
  await withNotifications(({ api, agent, compile, target, collect, isAlive }) => {
    let held = target;
    const callback = api.registerNativeClosure(
      () => {
        void held;
      },
      () => ({ bindings: [{ name: "held", get: () => held }], ambientNames: [] }),
    );
    agent.evaluate(compile("1"), callback, false);
    collect();
    expect(isAlive()).toBe(true);
    held = api.Value.undefined;
    collect();
    expect(isAlive()).toBe(false);
    agent.resumeEvaluate();
  });
});

it("does not retain an idle callback after removal before evaluation", async () => {
  await withNotifications(({ api, target, callbacks, collect, isAlive }) => {
    const callback = api.registerNativeClosure(
      () => {
        void target;
      },
      () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
    );
    callbacks.add(callback);
    collect();
    expect(isAlive()).toBe(true);
    callbacks.delete(callback);
    collect();
    expect(isAlive()).toBe(false);
  });
});

it.each([false, true])(
  "keeps unregistered and undeclared record captures opaque, registered=%s",
  async (registered) => {
    await withNotifications(({ api, agent, compile, target, collect, isAlive }) => {
      const holder = { target };
      const callback = () => {
        void holder.target;
      };
      if (registered)
        api.registerNativeClosure(callback, () => ({
          bindings: [{ name: "holder", get: () => holder }],
          ambientNames: [],
        }));
      agent.evaluate(compile("1"), callback, false);
      collect();
      expect(isAlive()).toBe(false);
      agent.resumeEvaluate();
    });
  },
);

it.each(["finish", "idle"])(
  "retains the active %s callback even after its registration disappears",
  async (kind) => {
    await withNotifications(({ api, agent, compile, target, callbacks, collect, isAlive }) => {
      const observations: boolean[] = [];
      const callback = api.registerNativeClosure(
        () => {
          callbacks.delete(callback);
          collect();
          observations.push(isAlive());
          void target;
        },
        () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
      );
      if (kind === "idle") callbacks.add(callback);
      agent.evaluate(compile("1"), kind === "finish" ? callback : () => {});
      expect(observations).toEqual([true]);
      collect();
      expect(isAlive()).toBe(false);
    });
  },
);

it.each(["normal", "throw"])(
  "retains a %s completion argument through nested notifications and the idle phase",
  async (kind) => {
    await withAbstractFixture(({ api, agent, realm, compile }) => {
      const callbacks: unknown = Reflect.get(agent, "onNoEvaluator");
      if (!(callbacks instanceof Set)) throw new Error("Expected callbacks");
      const observations: boolean[] = [];
      const observe = () => {
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
        const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
        if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
        observations.push(reference.WeakRefTarget !== undefined);
      };
      const idle = () => {
        callbacks.delete(idle);
        observe();
      };
      const nested = compile("2");
      agent.evaluate(
        compile(
          `var reference; (()=>{const held={};reference=new WeakRef(held);${kind === "throw" ? "throw held" : "return held"}})()`,
        ),
        (completion) => {
          expect(completion.Type).toBe(kind);
          observe();
          agent.evaluate(nested, () => {
            observe();
          });
          observe();
          callbacks.add(idle);
        },
      );
      expect(observations).toEqual([true, true, true, true]);
      observe();
      expect(observations.at(-1)).toBe(false);
    });
  },
);

it.each(["finish", "idle"])("releases active %s roots when notification throws", async (kind) => {
  await withNotifications(({ api, agent, compile, target, callbacks, collect, isAlive }) => {
    const failure = new Error("Notification failed");
    let aliveDuringCallback = false;
    const callback = api.registerNativeClosure(
      () => {
        callbacks.delete(callback);
        collect();
        aliveDuringCallback = isAlive();
        void target;
        throw failure;
      },
      () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
    );
    if (kind === "idle") callbacks.add(callback);
    let caught: unknown;
    try {
      agent.evaluate(compile("1"), kind === "finish" ? callback : () => {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(aliveDuringCallback).toBe(true);
    collect();
    expect(isAlive()).toBe(false);
    agent.evaluate(compile("2"), () => {});
    expect(agent.isPaused()).toBe(false);
  });
});

it.each(
  [false, true].flatMap((fallback) =>
    ["return", "throw", "reenter"].map((action) => ({ fallback, action })),
  ),
)(
  "preserves result getter timing and roots, fallback=$fallback action=$action",
  async ({ fallback, action }) => {
    await withNotifications(({ api, agent, compile, target, collect, isAlive }) => {
      if (fallback) {
        agent.hostDefinedOptions.onDebugger = () => {};
        agent.evaluate(compile("debugger; 1"), () => {}, false);
        agent.resumeEvaluate();
      }
      const failure = new Error("Result getter failed");
      let reads = 0;
      let notifications = 0;
      const nested = compile("3");
      const result = {
        done: true,
        get value() {
          reads++;
          expect(agent.isPaused()).toBe(fallback);
          collect();
          expect(isAlive()).toBe(true);
          if (action === "throw") throw failure;
          if (action === "reenter") {
            agent.evaluate(nested, () => {});
            collect();
            expect(isAlive()).toBe(true);
          }
          return api.Value(7);
        },
      };
      const iterator = compile("1");
      Object.defineProperty(iterator, "next", { value: () => result });
      const callback = api.registerNativeClosure(
        () => {
          notifications++;
          void target;
        },
        () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
      );
      let caught: unknown;
      try {
        agent.evaluate(iterator, callback);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(action === "throw" ? failure : undefined);
      expect(reads).toBe(1);
      expect(notifications).toBe(action === "throw" ? 0 : 1);
      collect();
      expect(isAlive()).toBe(false);
      if (fallback) agent.resumeEvaluate();
      agent.evaluate(compile("4"), () => {});
    });
  },
);

it.each([false, true])(
  "preserves callback receivers and completion argument count, fallback=%s",
  async (fallback) => {
    await withNotifications(({ agent, compile, callbacks }) => {
      const observations: string[] = [];
      const observer = {
        finish(this: unknown, ...argumentsList: unknown[]) {
          observations.push(`finish:${this === undefined}:${argumentsList.length}`);
        },
        idle(this: unknown, ...argumentsList: unknown[]) {
          observations.push(`idle:${this === undefined}:${argumentsList.length}`);
        },
      };
      if (fallback) {
        agent.hostDefinedOptions.onDebugger = () => {};
        agent.evaluate(compile("debugger; 1"), () => {}, false);
        agent.resumeEvaluate();
      }
      callbacks.add(observer.idle);
      agent.evaluate(compile("2"), observer.finish);
      if (fallback) {
        expect(observations).toEqual(["finish:true:1"]);
        agent.resumeEvaluate();
      }
      expect(observations).toEqual(["finish:true:1", "idle:true:0"]);
      callbacks.clear();
    });
  },
);

it("releases synchronous fallback callback roots on an exception without losing the outer evaluator", async () => {
  await withNotifications(({ api, agent, compile, target, collect, isAlive }) => {
    agent.hostDefinedOptions.onDebugger = () => {};
    agent.evaluate(compile("debugger; 1"), () => {}, false);
    agent.resumeEvaluate();
    const failure = new Error("Fallback notification failed");
    const callback = api.registerNativeClosure(
      () => {
        collect();
        expect(isAlive()).toBe(true);
        void target;
        throw failure;
      },
      () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
    );
    let caught: unknown;
    try {
      agent.evaluate(compile("2"), callback);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    collect();
    expect(isAlive()).toBe(false);
    expect(agent.isPaused()).toBe(true);
    expect(agent.resumeEvaluate().done).toBe(true);
  });
});

it("keeps a fallback evaluator's partial accumulator live during collection", async () => {
  await withAbstractFixture(({ api, agent, realm, compile }) => {
    agent.hostDefinedOptions.onDebugger = () => {};
    agent.evaluate(compile("debugger; 1"), () => {}, false);
    agent.resumeEvaluate();
    const observations: boolean[] = [];
    const observe = () => {
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
      if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
      observations.push(reference.WeakRefTarget !== undefined);
    };
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === "UnaryExpression" && node.sourceText === "void 77") observe();
    };
    agent.evaluate(
      compile(
        "var reference; [(()=>{const held={};reference=new WeakRef(held);return held})(),void 77]",
      ),
      () => {
        observe();
      },
    );
    expect(observations).toEqual([true, true]);
    observe();
    expect(observations.at(-1)).toBe(false);
    agent.resumeEvaluate();
  });
});

it("keeps declared Symbol captures live until completion", async () => {
  await withAbstractFixture(({ api, agent, realm, evaluate, compile }) => {
    const target = evaluate("var key = Symbol();var reference = new WeakRef(key);key").Value;
    evaluate("key = null");
    const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
    if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
    const callback = api.registerNativeClosure(
      () => {
        void target;
      },
      () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
    );
    agent.evaluate(compile("1"), callback, false);
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(reference.WeakRefTarget === target).toBe(true);
    agent.resumeEvaluate();
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(reference.WeakRefTarget === undefined).toBe(true);
  });
});

it("roots a synchronous fallback evaluator's callback during execution and notification", async () => {
  await withNotifications(({ api, agent, compile, target, collect, isAlive }) => {
    agent.hostDefinedOptions.onDebugger = () => {};
    agent.evaluate(compile("debugger; 1"), () => {}, false);
    agent.resumeEvaluate();
    expect(agent.isPaused()).toBe(true);
    const observations: boolean[] = [];
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === "UnaryExpression" && node.sourceText === "void 77") {
        collect();
        observations.push(isAlive());
      }
    };
    const callback = api.registerNativeClosure(
      () => {
        collect();
        observations.push(isAlive());
        void target;
      },
      () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
    );
    agent.evaluate(compile("void 77; 2"), callback);
    expect(observations).toEqual([true, true]);
    collect();
    expect(isAlive()).toBe(false);
    agent.resumeEvaluate();
    expect(agent.isPaused()).toBe(false);
  });
});

it("preserves live Set iteration, callback arguments and nested notification order", async () => {
  await withNotifications(({ agent, compile, callbacks }) => {
    const observations: string[] = [];
    const last = (...argumentsList: unknown[]) => {
      observations.push(`last:${argumentsList.length}`);
    };
    const skipped = () => {
      observations.push("skipped");
    };
    const first = () => {
      observations.push("first");
      callbacks.delete(first);
      callbacks.delete(skipped);
      callbacks.add(last);
    };
    callbacks.add(first);
    callbacks.add(skipped);
    const nested = compile("2");
    agent.evaluate(compile("1"), () => {
      observations.push("finish");
      agent.evaluate(nested, () => {
        observations.push("nested");
      });
    });
    const native = runInNewContext(
      `const observations=[];const callbacks=new Set();const last=(...args)=>observations.push('last:'+args.length);const skipped=()=>observations.push('skipped');const first=()=>{observations.push('first');callbacks.delete(first);callbacks.delete(skipped);callbacks.add(last)};callbacks.add(first);callbacks.add(skipped);const notify=callback=>{callback();for(const callback of callbacks)callback()};notify(()=>{observations.push('finish');notify(()=>observations.push('nested'))});observations`,
    );
    expect(observations).toEqual(native);
    callbacks.clear();
  });
});
