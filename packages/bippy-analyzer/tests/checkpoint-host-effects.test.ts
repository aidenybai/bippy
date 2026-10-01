import { expect, it } from "vite-plus/test";
import type { EvaluationCheckpoint } from "../engine/dist/declaration/index.mjs";
import { createConcreteRuntime, type ConcreteRuntime } from "../src/concrete/runtime.js";
import { getSymbolicEngine, type SymbolicEngine } from "../src/symbolic/load-engine.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

interface HostEffectFixture {
  api: SymbolicEngine["api"];
  runtime: ConcreteRuntime;
  checkpoint: EvaluationCheckpoint;
  resume: () => unknown;
}

const withHostEffect = async (effect: string, run: (fixture: HostEffectFixture) => void) => {
  const runtime = await createConcreteRuntime();
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(runtime.agent);
  try {
    runtime.evaluate(`
      var caught = false;
      var handle = setTimeout(() => {}, 0);
    `);
    api.X(
      api.CreateDataPropertyOrThrow(
        runtime.realm.GlobalObject,
        "enabled",
        api.BooleanValue.createAbstract(),
      ),
    );
    const compiled = api.EnsureCompletion(
      runtime.realm.compileScript(`
      if (enabled) {
        try {
          ${effect};
        } catch (error) {
          caught = true;
        }
      }
    `),
    );
    if (compiled.Type !== "normal") throw Error("Expected script");
    runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
    const pause = runtime.agent.resumeEvaluate({
      pauseOnAbstractBoolean: true,
      noBreakpoint: true,
    });
    if (pause.done || !pause.value) throw Error("Expected decision");
    const decision = pause.value;
    const checkpoint = runtime.agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    try {
      run({
        api,
        runtime,
        checkpoint,
        resume: () =>
          runtime.agent.resumeEvaluate({
            abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
            noBreakpoint: true,
          }),
      });
    } finally {
      checkpoint.release();
    }
  } finally {
    runtime.dispose();
    api.setSurroundingAgent(previous);
  }
};

it.each([
  "setTimeout(() => {}, 0)",
  "clearTimeout(handle)",
  "queueMicrotask(() => {})",
  "console.log('branch')",
  "console.info('branch')",
  "console.warn('branch')",
  "console.error('branch')",
  "Promise.resolve().then(() => {})",
  "Promise.resolve({ then() {} })",
  "Promise.reject('branch')",
  "(async () => { await 1; })()",
])("rejects %s before concrete host storage changes", async (effect) => {
  await withHostEffect(effect, ({ api, runtime, checkpoint, resume }) => {
    const timers = Object.getOwnPropertyDescriptor(runtime, "timers")?.value;
    if (!(timers instanceof Map)) throw Error("Expected timer storage");
    const entries = [...timers];
    const captured = entries.map(([, values]) => [...values]);
    const nextTimer = Object.getOwnPropertyDescriptor(runtime, "nextTimer")?.value;
    const jobs = runtime.jobs;
    const queuedJobs = runtime.agent.jobQueue.length;
    let failure: unknown;
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
    expect(runtime.jobs).toBe(jobs);
    expect(runtime.agent.jobQueue.length).toBe(queuedJobs);
    expect(runtime.consoleEntries).toEqual([]);
    expect(runtime.unhandledRejections.size).toBe(0);
    expect([...timers]).toEqual(entries);
    expect([...timers.values()]).toEqual(captured);
    expect(Object.getOwnPropertyDescriptor(runtime, "nextTimer")?.value).toBe(nextTimer);
    expect(runtime.realm.GlobalObject.properties.get("caught")?.Value).toBe(api.Value.false);
    for (const retry of [resume, checkpoint.restore]) {
      let repeated: unknown;
      try {
        retry();
      } catch (error) {
        repeated = error;
      }
      expect(repeated).toBe(failure);
    }
  });
});

it("rejects concrete disposal while a checkpoint is open", async () => {
  await withHostEffect("void 0", ({ runtime, resume }) => {
    expect(() => runtime.dispose()).toThrow(
      "Host effects are unsupported during evaluation checkpoints",
    );
    expect(Object.getOwnPropertyDescriptor(runtime, "isDisposed")?.value).toBe(false);
    expect(resume()).toHaveProperty("done", true);
  });
});

it.each(["web", "node", "microtask"])(
  "guards %s loop entry points before queue mutation or notification",
  async (kind) => {
    await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
      const loop =
        kind === "web"
          ? new api.WebLikeEventLoop(agent)
          : kind === "node"
            ? new api.NodeJSLikeEventLoop(agent)
            : new api.MicroTaskEventLoop(agent);
      const job = {
        queueName: "test",
        callerRealm: realm,
        callerScriptOrModule: null,
        job: () => api.GetValue(api.Value.undefined),
      };
      let notifications = 0;
      agent.jobQueue.onNewJob.add(() => notifications++);
      createBoolean("enabled");
      agent.evaluate(compile("if (enabled) void 0"), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
      const before: unknown[] = [];
      loop.mark((value) => before.push(value));
      let executorCalls = 0;
      try {
        for (const action of [
          () => loop.enqueue("timers", job),
          () =>
            loop.enqueueAsync("timers", job, () => {
              executorCalls++;
            }),
          () => loop.run("automatic"),
          () => loop.runOnce(),
        ])
          expect(action).toThrow("Host effects are unsupported during evaluation checkpoints");
        const after: unknown[] = [];
        loop.mark((value) => after.push(value));
        expect(after).toEqual(before);
        expect(loop.hasPendingJobs).toBe(false);
        expect(agent.jobQueue.length).toBe(0);
        expect(notifications).toBe(0);
        expect(executorCalls).toBe(0);
      } finally {
        checkpoint.release();
      }
      expect(
        agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: false,
          },
        }).done,
      ).toBe(true);
      loop.enqueue("timers", job);
      const afterRelease: unknown[] = [];
      loop.mark((value) => afterRelease.push(value));
      expect(
        kind === "microtask" ? agent.jobQueue.length === 1 : afterRelease.includes(job.job),
      ).toBe(true);
    });
  },
);

it("rejects pending async jobs before calling an owner and preserves the decision", async () => {
  await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
    let cancel = () => {};
    agent.eventLoop.enqueueAsync(
      "timers",
      {
        queueName: "pending",
        callerRealm: realm,
        callerScriptOrModule: null,
        job: () => api.GetValue(api.Value.undefined),
      },
      (_enqueue, cancelPending) => {
        cancel = cancelPending;
      },
    );
    createBoolean("enabled");
    agent.evaluate(compile("if (enabled) void 0"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw Error("Expected decision");
    let ownerCalls = 0;
    expect(() =>
      agent.captureEvaluation({
        capture: () => {
          ownerCalls++;
          return { restore: () => {} };
        },
      }),
    ).toThrow("Evaluation checkpoints do not support pending async host jobs");
    expect(ownerCalls).toBe(0);
    expect(agent.eventLoop.hasPendingJobs).toBe(true);
    cancel();
    const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    checkpoint.release();
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: {
          resume: "abstract-boolean",
          decision: pause.value,
          value: false,
        },
      }).done,
    ).toBe(true);
  });
});

it("guards capture and restore callbacks without publishing a failed capture", async () => {
  await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
    const enqueue = () =>
      agent.eventLoop.enqueue("timers", {
        queueName: "test",
        callerRealm: realm,
        callerScriptOrModule: null,
        job: () => api.GetValue(api.Value.undefined),
      });
    createBoolean("enabled");
    agent.evaluate(compile("if (enabled) void 0"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw Error("Expected decision");
    expect(() =>
      agent.captureEvaluation({ beginCapture: enqueue, capture: () => ({ restore: () => {} }) }),
    ).toThrow("Host effects are unsupported during evaluation checkpoints");
    const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: enqueue }) });
    expect(checkpoint.restore).toThrow(
      "Host effects are unsupported during evaluation checkpoints",
    );
    checkpoint.release();
  });
});

it("guards finalization hooks before invoking or scheduling them", async () => {
  await withAbstractFixture(({ api, agent, evaluate, compile, createBoolean }) => {
    const result = evaluate("new FinalizationRegistry(() => {})");
    if (result.Type !== "normal" || !api.isFinalizationRegistryObject(result.Value))
      throw Error("Expected registry");
    const registry = result.Value;
    let hookCalls = 0;
    agent.hostDefinedOptions.hostHooks = {
      HostEnqueueFinalizationRegistryCleanupJob: () => {
        hookCalls++;
      },
    };
    createBoolean("enabled");
    agent.evaluate(compile("if (enabled) void 0"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    try {
      expect(() => api.HostEnqueueFinalizationRegistryCleanupJob(registry)).toThrow(
        "Host effects are unsupported during evaluation checkpoints",
      );
      expect(hookCalls).toBe(0);
      delete agent.hostDefinedOptions.hostHooks.HostEnqueueFinalizationRegistryCleanupJob;
      expect(() => api.HostEnqueueFinalizationRegistryCleanupJob(registry)).toThrow(
        "Host effects are unsupported during evaluation checkpoints",
      );
      expect(agent.finalizationRegistryScheduledForCleanup.size).toBe(0);
      expect(agent.jobQueue.length).toBe(0);
    } finally {
      checkpoint.release();
    }
  });
});
