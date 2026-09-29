import { expect, it } from "vite-plus/test";
import type { EvaluatorYieldType_AbstractBoolean } from "../engine/dist/declaration/index.mjs";
import {
  withAbstractFixture as withEngineFixture,
  type AbstractFixture,
} from "./helpers/abstract-fixture.js";

const withAbstractFixture = (run: (fixture: AbstractFixture) => void) =>
  withEngineFixture((fixture) =>
    run({
      ...fixture,
      getNumber: (name) => {
        const value = fixture.realm.GlobalObject.properties.get(fixture.api.Value(name))?.Value;
        if (!(value instanceof fixture.api.NumberValue))
          throw new Error("Expected a global Number data property");
        return value;
      },
    }),
  );

const start = (fixture: AbstractFixture, source: string): EvaluatorYieldType_AbstractBoolean => {
  fixture.agent.evaluate(fixture.compile(source), () => {}, false);
  const step = fixture.agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
  if (step.done || !step.value || step.value.suspend !== "abstract-boolean")
    throw new Error("Expected an Agent-owned decision");
  return step.value;
};

it.each([false, true])("resumes an Agent-owned decision without replay: %s", async (choice) => {
  await withAbstractFixture((fixture) => {
    const { api, agent, createBoolean, compile, getNumber } = fixture;
    const input = createBoolean("enabled");
    let finishes = 0;
    let idle = 0;
    const depth = agent.executionContextStack.length;
    const idleCallbacks = Reflect.get(agent, "onNoEvaluator");
    if (!(idleCallbacks instanceof Set)) throw new Error("Expected idle callbacks");
    idleCallbacks.add(() => {
      idle++;
    });
    agent.evaluate(
      compile("var reads=0;function read(){reads++;return enabled;}if(read()) 11;else 22;"),
      (completion) => {
        finishes++;
        expect(completion.Value).toEqual(api.Value(choice ? 11 : 22));
      },
      false,
    );
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected a decision");
    expect(pause.value.value).toBe(input);
    expect(agent.resumeEvaluate()).toEqual(pause);
    expect(getNumber("reads").numberValue()).toBe(1);
    expect(finishes).toBe(0);
    expect(idle).toBe(0);
    const result = agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: choice },
    });
    expect(result.done).toBe(true);
    expect(finishes).toBe(1);
    expect(idle).toBe(1);
    expect(agent.isPaused()).toBe(false);
    expect(agent.executionContextStack.length).toBe(depth);
    expect(getNumber("reads").numberValue()).toBe(1);
    expect(() => agent.resumeEvaluate()).toThrow("No paused evaluator");
  });
});

it.each(["clone", "value", "kind", "missing"])(
  "rejects a %s reply without advancing",
  async (kind) => {
    await withAbstractFixture((fixture) => {
      const { agent, createBoolean, getNumber, api } = fixture;
      createBoolean("enabled");
      const decision = start(fixture, "var entered=0;if(enabled) entered++;entered;");
      const response = {
        resume: kind === "kind" ? "debugger" : "abstract-boolean",
        decision: kind === "clone" ? { ...decision } : kind === "missing" ? undefined : decision,
        value: kind === "value" ? api.Value.true : true,
      };
      expect(() =>
        Reflect.apply(agent.resumeEvaluate, agent, [{ abstractBooleanDecision: response }]),
      ).toThrow("Invalid abstract Boolean decision response");
      expect(getNumber("entered").numberValue()).toBe(0);
      expect(agent.resumeEvaluate()).toEqual({ done: false, value: decision });
      expect(
        agent.resumeEvaluate({
          abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
        }).done,
      ).toBe(true);
      expect(getNumber("entered").numberValue()).toBe(1);
    });
  },
);

it("rejects a stale reply between correlated decisions without advancing", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, getNumber } = fixture;
    createBoolean("enabled");
    const first = start(
      fixture,
      "var entered=0;if(enabled) entered++;if(enabled) entered++;entered;",
    );
    const second = agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision: first, value: true },
    });
    if (second.done || !second.value) throw new Error("Expected second decision");
    expect(second.value).not.toBe(first);
    expect(second.value.value).toBe(first.value);
    expect(() =>
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: first, value: false },
      }),
    ).toThrow("Invalid abstract Boolean decision response");
    expect(getNumber("entered").numberValue()).toBe(1);
    agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision: second.value, value: true },
    });
    expect(getNumber("entered").numberValue()).toBe(2);
  });
});

it("reads the reply choice once and rejects reentrant resume", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean } = fixture;
    createBoolean("enabled");
    const decision = start(fixture, "enabled ? 11 : 22");
    let reads = 0;
    const result = agent.resumeEvaluate({
      abstractBooleanDecision: {
        resume: "abstract-boolean",
        decision,
        get value() {
          reads++;
          expect(() => agent.resumeEvaluate()).toThrow(
            "Cannot resume an evaluator during execution",
          );
          return reads === 1;
        },
      },
    });
    expect(result.done).toBe(true);
    expect(reads).toBe(1);
  });
});

it("does not consume a decision after a throwing reply getter", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean } = fixture;
    createBoolean("enabled");
    const decision = start(fixture, "enabled ? 11 : 22");
    const failure = new Error("reply getter");
    expect(() =>
      agent.resumeEvaluate({
        abstractBooleanDecision: {
          resume: "abstract-boolean",
          decision,
          get value(): boolean {
            throw failure;
          },
        },
      }),
    ).toThrow(failure);
    expect(agent.resumeEvaluate()).toEqual({ done: false, value: decision });
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision, value: false },
      }).done,
    ).toBe(true);
  });
});

it("rejects a nested evaluator before its prefix executes", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, compile, getNumber } = fixture;
    createBoolean("enabled");
    const decision = start(fixture, "var entered=0;if(enabled) entered++;entered;");
    expect(() => agent.evaluate(compile("entered+=10"), () => {})).toThrow(
      "Cannot start an evaluator during controlled execution",
    );
    expect(getNumber("entered").numberValue()).toBe(0);
    agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
    });
    expect(getNumber("entered").numberValue()).toBe(1);
  });
});

it.each([false, true])(
  "roots a partial array while an Agent decision is pending: %s",
  async (choice) => {
    await withAbstractFixture((fixture) => {
      const { api, agent, createBoolean, evaluate } = fixture;
      createBoolean("enabled");
      const decision = start(
        fixture,
        `var reference, retained;function create(){const target={value:7};reference=new WeakRef(target);return target;}retained=[create(),enabled ? 1 : 2];`,
      );
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      const reference = fixture.realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
      if (!(reference instanceof api.ObjectValue) || !api.isWeakRef(reference))
        throw new Error("Expected a WeakRef");
      expect(reference.WeakRefTarget !== undefined).toBe(true);
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision, value: choice },
      });
      expect(evaluate("retained[0].value").Value).toEqual(api.Value(7));
      evaluate("retained=undefined");
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(evaluate("reference.deref() === undefined").Value).toBe(api.Value.true);
    });
  },
);

it("leaves guest throws as completions and allows the next evaluation", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, compile, api } = fixture;
    createBoolean("enabled");
    const decision = start(fixture, "if(enabled)throw 7;");
    const result = agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
    });
    if (!result.done) throw new Error("Expected completion");
    expect(api.EnsureCompletion(result.value).Type).toBe("throw");
    let finished = false;
    agent.evaluate(compile("11"), () => {
      finished = true;
    });
    expect(finished).toBe(true);
  });
});

it("poisons evaluator execution after a host failure", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, compile } = fixture;
    createBoolean("enabled");
    const decision = start(fixture, "if(enabled) 11; else 22;");
    const failure = new Error("host evaluation failed");
    agent.hostDefinedOptions.onNodeEvaluation = () => {
      throw failure;
    };
    expect(() =>
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
      }),
    ).toThrow(failure);
    agent.hostDefinedOptions.onNodeEvaluation = undefined;
    const roots = new Set<unknown>();
    agent.mark((value) => roots.add(value));
    expect(roots.has(failure)).toBe(true);
    expect(() => agent.resumeEvaluate()).toThrow(failure);
    expect(() => agent.evaluate(compile("33"), () => {})).toThrow(failure);
  });
});

it("preserves debugger pauses around an abstract decision", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, compile } = fixture;
    createBoolean("enabled");
    let debuggerCalls = 0;
    agent.hostDefinedOptions.onDebugger = () => {
      debuggerCalls++;
    };
    agent.evaluate(compile("debugger;if(enabled) 11;debugger;22;"), () => {}, false);
    expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true })).toEqual({
      done: false,
      value: undefined,
    });
    const decision = agent.resumeEvaluate();
    if (decision.done || !decision.value) throw new Error("Expected decision");
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: {
          resume: "abstract-boolean",
          decision: decision.value,
          value: true,
        },
      }),
    ).toEqual({ done: false, value: undefined });
    expect(agent.resumeEvaluate().done).toBe(true);
    expect(debuggerCalls).toBe(2);
  });
});

it("preserves default rejection and permits an explicit opt-in afterward", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, compile } = fixture;
    createBoolean("enabled");
    agent.evaluate(compile("enabled ? 1 : 2"), () => {}, false);
    expect(() => agent.resumeEvaluate()).toThrow(
      "Abstract Boolean decision requires an explicit resume",
    );
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected the saved decision");
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: true },
      }).done,
    ).toBe(true);
  });
});

it("rejects unsolicited replies and malformed pause options before the prefix", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, compile } = fixture;
    createBoolean("enabled");
    agent.evaluate(compile("if(enabled) 1;"), () => {}, false);
    expect(() =>
      Reflect.apply(agent.resumeEvaluate, agent, [{ abstractBooleanDecision: {} }]),
    ).toThrow("No pending abstract Boolean decision");
    for (const pauseOnAbstractBoolean of [1, "true", null]) {
      expect(() =>
        Reflect.apply(agent.resumeEvaluate, agent, [{ pauseOnAbstractBoolean }]),
      ).toThrow("Abstract Boolean pause option must be a Boolean");
    }
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected a decision");
    agent.resumeEvaluate({
      abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: false },
    });
  });
});

it("rejects reentrant execution from evaluation hooks without losing the outer evaluator", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, compile } = fixture;
    createBoolean("enabled");
    let attempted = false;
    agent.hostDefinedOptions.onNodeEvaluation = () => {
      if (attempted) return;
      attempted = true;
      expect(() => agent.resumeEvaluate()).toThrow("Cannot resume an evaluator during execution");
      expect(() => agent.evaluate(compile("77"), () => {})).toThrow(
        "Cannot start an evaluator during controlled execution",
      );
    };
    const decision = start(fixture, "enabled ? 1 : 2");
    expect(attempted).toBe(true);
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
      }).done,
    ).toBe(true);
  });
});

it("allows a completion callback to register the next evaluator", async () => {
  await withAbstractFixture((fixture) => {
    const { agent, createBoolean, compile } = fixture;
    createBoolean("enabled");
    let finishes = 0;
    agent.evaluate(
      compile("if(enabled) 1;"),
      () => {
        finishes++;
        agent.evaluate(compile("2"), () => {
          finishes++;
        });
      },
      false,
    );
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected a decision");
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: true },
      }).done,
    ).toBe(true);
    expect(finishes).toBe(2);
    expect(agent.isPaused()).toBe(false);
  });
});

it("rejects a foreign current Agent before advancing a controlled evaluator", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent, createBoolean } = fixture;
    createBoolean("enabled");
    const decision = start(fixture, "enabled ? 1 : 2");
    const foreign = new api.Agent({ startEventLoop: false });
    api.setSurroundingAgent(foreign);
    try {
      expect(() =>
        agent.resumeEvaluate({
          abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
        }),
      ).toThrow("Controlled evaluator belongs to another Agent");
    } finally {
      api.setSurroundingAgent(agent);
    }
    expect(agent.resumeEvaluate()).toEqual({ done: false, value: decision });
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
      }).done,
    ).toBe(true);
  });
});
