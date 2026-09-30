import { expect, it } from "vite-plus/test";
import type { Value } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

interface RootFixture extends AbstractFixture {
  target: Value;
  collect: () => void;
  isAlive: () => boolean;
}

const withRootFixture = async (run: (fixture: RootFixture) => void, source = "{}") => {
  await withAbstractFixture((fixture) => {
    const { api, agent, realm, evaluate } = fixture;
    const target = evaluate(
      `var target = (${source}); var reference = new WeakRef(target); target`,
    ).Value;
    evaluate("target = undefined");
    const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
    if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
    run({
      ...fixture,
      target,
      collect: () => {
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
      },
      isAlive: () => reference.WeakRefTarget === target,
    });
  });
};

it.each(["{}", "Symbol('target')"])(
  "copies scoped roots and releases %s after return",
  async (source) => {
    await withRootFixture(({ agent, target, collect, isAlive }) => {
      const roots = [target];
      const result = agent.withGCRoots(roots, () => {
        roots.length = 0;
        collect();
        expect(isAlive()).toBe(true);
        return target;
      });
      expect(result === target).toBe(true);
      collect();
      expect(isAlive()).toBe(false);
    }, source);
  },
);

it("preserves outer roots through nested scopes and exact thrown errors", async () => {
  await withRootFixture(({ agent, target, collect, isAlive }) => {
    const failure = new Error("scope failed");
    agent.withGCRoots([target], () => {
      let caught: unknown;
      try {
        agent.withGCRoots([], () => {
          collect();
          expect(isAlive()).toBe(true);
          throw failure;
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      collect();
      expect(isAlive()).toBe(true);
    });
    collect();
    expect(isAlive()).toBe(false);
  });
});

it("releases roots when the outer callback throws", async () => {
  await withRootFixture(({ agent, target, collect, isAlive }) => {
    const failure = new Error("outer scope failed");
    let caught: unknown;
    try {
      agent.withGCRoots([target], () => {
        collect();
        expect(isAlive()).toBe(true);
        throw failure;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    collect();
    expect(isAlive()).toBe(false);
  });
});

it.each(["registered", "unregistered", "record"])(
  "keeps the existing %s capture boundary",
  async (kind) => {
    await withRootFixture(({ api, agent, target, collect, isAlive }) => {
      const closure = () => target;
      const root =
        kind === "record"
          ? Object.freeze({ target })
          : kind === "registered"
            ? api.registerNativeClosure(closure, () => ({
                bindings: [{ name: "target", get: () => target }],
                ambientNames: [],
              }))
            : closure;
      agent.withGCRoots([root], () => {
        collect();
        expect(isAlive()).toBe(kind === "registered");
      });
      collect();
      expect(isAlive()).toBe(false);
    });
  },
);

it("ends the scope when a callback returns a Promise, not when it settles", async () => {
  await withRootFixture(({ agent, target, collect, isAlive }) => {
    const pending = Promise.resolve(target);
    expect(agent.withGCRoots([target], () => pending)).toBe(pending);
    collect();
    expect(isAlive()).toBe(false);
  });
});

it("rejects a foreign Agent before entering the callback", async () => {
  await withRootFixture(({ api, agent, target, collect, isAlive }) => {
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    let calls = 0;
    try {
      expect(() =>
        agent.withGCRoots([target], () => {
          calls++;
        }),
      ).toThrow("GC roots belong to another Agent");
    } finally {
      api.setSurroundingAgent(agent);
    }
    expect(calls).toBe(0);
    collect();
    expect(isAlive()).toBe(false);
  });
});

it("includes scoped values in checkpoint discovery and saved GC roots", async () => {
  await withRootFixture(({ agent, compile, createBoolean, target, collect, isAlive }) => {
    createBoolean("enabled");
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    expect(pause.done).toBe(false);
    const checkpoint = agent.withGCRoots([target], () =>
      agent.captureEvaluation({
        capture: (roots) => {
          expect(roots.values.includes(target)).toBe(true);
          return { restore: () => {} };
        },
      }),
    );
    collect();
    expect(isAlive()).toBe(true);
    expect(() => agent.withGCRoots([target], () => agent.assertCanPerformHostEffect())).toThrow(
      "Host effects are unsupported during evaluation checkpoints",
    );
    checkpoint.release();
    collect();
    expect(isAlive()).toBe(false);
  });
});

it("discovers declared binding cells in scoped closures", async () => {
  await withRootFixture(({ api, agent, compile, createBoolean }) => {
    let count = 0;
    const increment = api.registerNativeClosure(
      () => ++count,
      () => ({
        bindings: [
          {
            name: "count",
            get: () => count,
            set: (value) => {
              if (typeof value !== "number") throw new Error("Expected count");
              count = value;
            },
          },
        ],
        ambientNames: [],
      }),
    );
    createBoolean("enabled");
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const checkpoint = agent.withGCRoots([increment], () =>
      agent.captureEvaluation({ capture: () => ({ restore: () => {} }) }),
    );
    expect(increment()).toBe(1);
    checkpoint.restore();
    expect(increment()).toBe(1);
    checkpoint.release();
  });
});

it.each(["getter", "owner"])(
  "retains saved binding values during the %s capture phase",
  async (phase) => {
    await withRootFixture(({ api, agent, compile, createBoolean, target, collect, isAlive }) => {
      let held: Value | undefined = target;
      let shouldCollect = true;
      const replaceAndCollect = () => {
        if (!shouldCollect) return;
        shouldCollect = false;
        held = undefined;
        collect();
        expect(isAlive()).toBe(true);
      };
      const closure = api.registerNativeClosure(
        () => held,
        () => ({
          bindings: [
            {
              name: "held",
              get: () => held,
              set: (value) => {
                if (value !== undefined && value !== target) throw new Error("Unexpected capture");
                held = value === undefined ? undefined : target;
              },
            },
            {
              name: "trigger",
              get: () => {
                if (phase === "getter") replaceAndCollect();
                return 0;
              },
            },
          ],
          ambientNames: [],
        }),
      );
      createBoolean("enabled");
      agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
      agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      const checkpoint = agent.withGCRoots([closure], () =>
        agent.captureEvaluation({
          capture: () => {
            if (phase === "owner") replaceAndCollect();
            return { restore: () => {} };
          },
        }),
      );
      expect(held).toBeUndefined();
      checkpoint.restore();
      expect(held === target).toBe(true);
      collect();
      expect(isAlive()).toBe(true);
      checkpoint.release();
      collect();
      expect(isAlive()).toBe(false);
    });
  },
);

it("cleans up after a capture-root listener rejects before owner hooks", async () => {
  await withRootFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const iterator = compile("enabled ? 1 : 2");
    agent.evaluate(iterator, () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const failure = new Error("Root listener failed");
    let begins = 0,
      captures = 0,
      caught: unknown;
    try {
      api.captureControl(
        iterator,
        {
          beginCapture: () => {
            begins++;
          },
          capture: () => {
            captures++;
            return { restore: () => {} };
          },
        },
        () => [],
        (values) => {
          expect(values).toHaveLength(0);
          expect(() =>
            api.captureControl(iterator, { capture: () => ({ restore: () => {} }) }),
          ).toThrow("Cannot checkpoint during execution or another checkpoint");
          throw failure;
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect([begins, captures]).toEqual([0, 0]);
    expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
    const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    checkpoint.release();
  });
});

it("lets an owner reject an unowned scoped dependency before capture", async () => {
  await withRootFixture(({ agent, compile, createBoolean, target }) => {
    const record = { target };
    const failure = new Error("Unowned scoped record");
    createBoolean("enabled");
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    let captures = 0,
      caught: unknown;
    try {
      agent.withGCRoots([record], () =>
        agent.captureEvaluation({
          references: (value) => {
            if (value === record) throw failure;
            return [];
          },
          capture: () => {
            captures++;
            return { restore: () => {} };
          },
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(captures).toBe(0);
    expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
    expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
  });
});
