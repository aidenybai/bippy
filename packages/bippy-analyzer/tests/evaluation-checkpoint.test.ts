import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

const start = (fixture: AbstractFixture, source: string) => {
  fixture.createBoolean("enabled");
  fixture.agent.evaluate(fixture.compile(source), () => {}, false);
  const step = fixture.agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
  if (step.done || !step.value) throw new Error("Expected decision");
  return step.value;
};
const capture = ({ api, agent, realm }: AbstractFixture) => {
  const contexts = [...agent.executionContextStack];
  const heap = api.createStateCheckpoint({
    objects: [realm.GlobalObject],
    environments: [realm.GlobalEnv.DeclarativeRecord],
  });
  try {
    const checkpoint = agent.captureEvaluation({
      capture: () => ({
        restore: () => {
          heap.restore();
          agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
        },
      }),
    });
    return {
      checkpoint,
      release: () => {
        checkpoint.release();
        heap.release();
      },
    };
  } catch (error) {
    heap.release();
    throw error;
  }
};

it.each([false, true])(
  "restores Agent decisions and completion registration without replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture((fixture) => {
      const { agent, api, realm, compile, createBoolean } = fixture;
      createBoolean("enabled");
      let prefixes = 0;
      const observations: string[] = [];
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.sourceText === "prefix++" && node.type === "UpdateExpression") prefixes++;
      };
      const source = `
        var prefix = 0,
          count = 0;
        prefix++;
        if (enabled) count = 11;
        else count = 22;
        count;
      `;
      agent.evaluate(
        compile(source),
        (completion) => {
          if (!(completion.Value instanceof api.NumberValue)) throw new Error("Expected Number");
          observations.push(String(completion.Value.numberValue()));
        },
        false,
      );
      const first = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (first.done || !first.value) throw new Error("Expected decision");
      const saved = capture(fixture);
      try {
        for (const choice of isReversed ? [true, false] : [false, true]) {
          saved.checkpoint.restore();
          expect(agent.resumeEvaluate().value === first.value).toBe(true);
          const step = agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: first.value,
              value: choice,
            },
          });
          expect(step.done).toBe(true);
          expect(agent.isPaused()).toBe(false);
          expect(observations.at(-1)).toBe(String(runInNewContext(source, { enabled: choice })));
          expect(realm.GlobalObject.properties.get(api.Value("prefix"))?.Value).toEqual(
            api.Value(1),
          );
          expect(() => agent.evaluate(compile("99"), () => {}, false)).toThrow(
            "checkpoints are open",
          );
        }
      } finally {
        saved.release();
      }
      expect(prefixes).toBe(1);
      expect(observations.length).toBe(2);
      agent.evaluate(compile("99"), () => {}, false);
      expect(agent.resumeEvaluate().done).toBe(true);
    });
  },
);

it("restores exact request identity across nested captures and rejects stale replies", async () => {
  await withAbstractFixture((fixture) => {
    const { agent } = fixture;
    const first = start(
      fixture,
      `
        var count = 0;
        if (enabled) count++;
        if (enabled) count++;
        count;
      `,
    );
    const outer = capture(fixture);
    const next = agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision: first, value: true },
    });
    if (next.done || !next.value) throw new Error("Expected second decision");
    const second = next.value;
    const inner = capture(fixture);
    expect(() => outer.checkpoint.restore()).toThrow("last-in-first-out");
    expect(() => outer.checkpoint.release()).toThrow("last-in-first-out");
    agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision: second, value: false },
    });
    inner.checkpoint.restore();
    expect(agent.resumeEvaluate().value === second).toBe(true);
    inner.release();
    outer.checkpoint.restore();
    expect(agent.resumeEvaluate().value === first).toBe(true);
    expect(() =>
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: second, value: true },
      }),
    ).toThrow("Invalid abstract Boolean");
    outer.release();
  });
});

it("roots saved evaluator values after completion and releases them without rewinding", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent, realm } = fixture;
    const decision = start(
      fixture,
      `
        var reference;
        function create() {
          const held = {};
          reference = new WeakRef(held);
          return held;
        }
        var result = [create(), enabled ? 1 : 2];
        result = null;
      `,
    );
    const saved = capture(fixture);
    agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
    });
    const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
    if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(reference.WeakRefTarget !== undefined).toBe(true);
    saved.release();
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(reference.WeakRefTarget === undefined).toBe(true);
    expect(() => saved.checkpoint.restore()).toThrow("released");
    expect(() => saved.checkpoint.release()).toThrow("released");
  });
});

it("rejects foreign Agent access before restoring", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent } = fixture;
    start(fixture, "enabled?1:2");
    const saved = capture(fixture);
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      expect(() => saved.checkpoint.restore()).toThrow("another Agent");
      expect(() => saved.checkpoint.release()).toThrow("another Agent");
      expect(() => agent.captureEvaluation({ capture: () => ({ restore: () => {} }) })).toThrow(
        "another Agent",
      );
    } finally {
      api.setSurroundingAgent(agent);
    }
    saved.checkpoint.restore();
    saved.release();
  });
});

it("blocks Agent execution and checkpoint reentry in owner callbacks", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, compile } = fixture;
    start(fixture, "enabled?1:2");
    const owner = { capture: () => ({ restore: () => {} }) };
    const other = compile("7");
    const check = () => {
      expect(() => agent.resumeEvaluate()).toThrow("during an Agent checkpoint");
      expect(() => agent.evaluate(other, () => {}, false)).toThrow("during an Agent checkpoint");
      expect(() => agent.captureEvaluation(owner)).toThrow("during Agent execution");
    };
    const checkpoint = agent.captureEvaluation({
      beginCapture: check,
      capture: () => {
        check();
        return { restore: check };
      },
    });
    checkpoint.restore();
    checkpoint.release();
  });
});

it("rejects capture during execution and leaves a failed capture unregistered", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, compile, createBoolean } = fixture;
    createBoolean("enabled");
    const owner = { capture: () => ({ restore: () => {} }) };
    agent.hostDefinedOptions.onNodeEvaluation = () => {
      expect(() => agent.captureEvaluation(owner)).toThrow("during Agent execution");
    };
    agent.evaluate(compile("enabled?1:2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    agent.hostDefinedOptions.onNodeEvaluation = undefined;
    expect(() =>
      agent.captureEvaluation({
        capture: () => {
          throw new Error("capture failed");
        },
      }),
    ).toThrow("capture failed");
    const checkpoint = agent.captureEvaluation(owner);
    checkpoint.release();
  });
});

it("poisons the registered evaluator on owner restoration failure", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, compile } = fixture;
    const decision = start(fixture, "enabled?1:2");
    const failure = new Error("owner failed");
    const checkpoint = agent.captureEvaluation({
      capture: () => ({
        restore: () => {
          throw failure;
        },
      }),
    });
    agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
    });
    expect(() => checkpoint.restore()).toThrow(failure);
    expect(() => agent.resumeEvaluate()).toThrow(failure);
    checkpoint.release();
    expect(() => agent.evaluate(compile("1"), () => {})).toThrow(failure);
  });
});

it("does not recover an execution failure through a saved checkpoint", async () => {
  await withAbstractFixture((fixture) => {
    const { agent } = fixture;
    const decision = start(
      fixture,
      `
        var count = 0;
        if (enabled) count++;
        count;
      `,
    );
    const saved = capture(fixture);
    const failure = new Error("execution failed");
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === "UpdateExpression") throw failure;
    };
    expect(() =>
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
      }),
    ).toThrow(failure);
    expect(() => saved.checkpoint.restore()).toThrow(failure);
    saved.release();
  });
});

it("guards owner accessors and reads the capture callback once", async () => {
  await withAbstractFixture((fixture) => {
    const { agent } = fixture;
    start(fixture, "enabled?1:2");
    let reads = 0;
    const checkpoint = agent.captureEvaluation({
      get capture() {
        reads++;
        expect(() => agent.resumeEvaluate()).toThrow("during an Agent checkpoint");
        return () => ({ restore: () => {} });
      },
    });
    expect(reads).toBe(1);
    checkpoint.restore();
    checkpoint.release();
  });
});

it("rejects foreign control without leaving an open checkpoint", async () => {
  await withAbstractFixture(({ api, agent, createBoolean, compile }) => {
    const decision = { suspend: "abstract-boolean", value: createBoolean("enabled") };
    let visits = 0;
    const iterator = {
      next: () =>
        ++visits === 1 ? { done: false, value: decision } : { done: true, value: api.Value(7) },
    };
    Reflect.apply(agent.evaluate, agent, [iterator, () => {}, false]);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    expect(() => agent.captureEvaluation({ capture: () => ({ restore: () => {} }) })).toThrow(
      "foreign continuation",
    );
    Reflect.apply(agent.resumeEvaluate, agent, [
      { abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true } },
    ]);
    agent.evaluate(compile("8"), () => {}, false);
    expect(agent.resumeEvaluate().done).toBe(true);
  });
});

it("requires controlled registered execution and a state owner", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, compile } = fixture;
    const owner = { capture: () => ({ restore: () => {} }) };
    expect(() => agent.captureEvaluation(owner)).toThrow("controlled evaluator");
    agent.evaluate(compile("debugger;1"), () => {}, false);
    expect(() => agent.captureEvaluation(owner)).toThrow("controlled evaluator");
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    start(fixture, "enabled?1:2");
    expect(() => Reflect.apply(agent.captureEvaluation, agent, [undefined])).toThrow("state owner");
  });
});

it("rejects checkpoint access from completion callbacks without changing the saved suspension", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, compile, createBoolean } = fixture;
    createBoolean("enabled");
    let saved: ReturnType<typeof capture> | undefined;
    agent.evaluate(
      compile("enabled?1:2"),
      () => {
        const current = saved;
        if (!current) throw new Error("Expected checkpoint");
        expect(() => current.checkpoint.restore()).toThrow("during Agent execution");
        expect(() => current.checkpoint.release()).toThrow("during Agent execution");
      },
      false,
    );
    const step = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (step.done || !step.value) throw new Error("Expected decision");
    saved = capture(fixture);
    try {
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: step.value, value: true },
      });
      saved.checkpoint.restore();
      expect(agent.resumeEvaluate().value === step.value).toBe(true);
    } finally {
      saved.release();
    }
  });
});

it("restores controlled debugger pauses and rejects debugger-preview access", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent, compile, createBoolean } = fixture;
    createBoolean("enabled");
    agent.hostDefinedOptions.onDebugger = () => {};
    agent.evaluate(compile("debugger;enabled?1:2"), () => {}, false);
    expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true })).toEqual({
      done: false,
      value: undefined,
    });
    const saved = capture(fixture);
    const decision = agent.resumeEvaluate();
    expect(decision.value).toBeDefined();
    api.surroundingAgent.debugger_scopePreview(() => {
      expect(() => saved.checkpoint.restore()).toThrow("debugger preview");
    });
    saved.checkpoint.restore();
    const repeated = agent.resumeEvaluate();
    expect(repeated.done).toBe(false);
    expect(repeated.value).toBeDefined();
    expect(repeated.value === decision.value).toBe(false);
    saved.release();
  });
});
