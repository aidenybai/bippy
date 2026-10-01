import { expect, it } from "vite-plus/test";
import type { Agent, Job, WebLikeEventLoop } from "../engine/dist/declaration/index.mjs";
import { getSymbolicEngine, type SymbolicEngine } from "../src/symbolic/load-engine.js";

interface QueueFixture {
  api: SymbolicEngine["api"];
  agent: Agent;
  loop: WebLikeEventLoop;
  events: string[];
  createJob: (name: string) => Job;
}

const withQueue = async (run: (fixture: QueueFixture) => void) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const agent = new api.Agent({ startEventLoop: false });
  api.setSurroundingAgent(agent);
  try {
    if (!(agent.eventLoop instanceof api.WebLikeEventLoop)) throw Error("Expected web loop");
    const events: string[] = [];
    run({
      api,
      agent,
      loop: agent.eventLoop,
      events,
      createJob: (name) => ({
        queueName: name,
        callerRealm: undefined,
        callerScriptOrModule: null,
        job: () => {
          events.push(name);
          return api.GetValue(api.Value.undefined);
        },
      }),
    });
  } finally {
    api.setSurroundingAgent(previous);
  }
};

it.each([false, true])(
  "restores queue membership, identities and order, reversed=%s",
  async (isReversed) => {
    await withQueue(({ loop, events, createJob }) => {
      const first = createJob("first");
      const second = createJob("second");
      loop.enqueue("timers", first);
      loop.enqueue("__proto__", second);
      const queuedJobs = Object.getOwnPropertyDescriptor(loop, "queuedJobs")?.value;
      const jobsByType = Object.getOwnPropertyDescriptor(loop, "jobsByType")?.value;
      const originalTypes = Object.getOwnPropertyDescriptors(jobsByType);
      const checkpoint = loop.captureQueue();
      expect(checkpoint.scope).toBe("web-event-loop-macrotask-membership-v1");
      expect(checkpoint.jobCount).toBe(2);
      try {
        for (const name of isReversed ? ["right", "left"] : ["left", "right"]) {
          checkpoint.restore();
          loop.enqueue("branch", createJob(name));
          expect(Object.getOwnPropertyDescriptor(loop, "queuedJobs")?.value).toBe(queuedJobs);
          expect(Object.getOwnPropertyDescriptor(loop, "jobsByType")?.value).toBe(jobsByType);
          for (const [type, descriptor] of Object.entries(originalTypes))
            expect(jobsByType[type]).toBe(descriptor.value);
          loop.runOnce();
          expect(events.slice(-3)).toEqual(["first", "second", name]);
        }
        checkpoint.restore();
        expect(Object.keys(jobsByType)).toEqual(["timers", "__proto__"]);
        expect([...queuedJobs.keys()]).toEqual([first, second]);
        expect([...jobsByType.timers]).toEqual([first]);
      } finally {
        checkpoint.release();
      }
      loop.runOnce();
      expect(events.slice(-2)).toEqual(["first", "second"]);
      expect(() => checkpoint.restore()).toThrow("Queue checkpoint is released");
    });
  },
);

it("retains nested LIFO snapshots and leaves microtasks outside selection", async () => {
  await withQueue(({ agent, loop, createJob, events }) => {
    const parent = loop.captureQueue();
    loop.enqueue("timers", createJob("outer"));
    const child = loop.captureQueue();
    loop.enqueue("timers", createJob("inner"));
    agent.jobQueue.enqueueGenericJob(createJob("microtask"));
    expect(() => parent.restore()).toThrow("last-in-first-out");
    expect(() => parent.release()).toThrow("last-in-first-out");
    child.restore();
    child.release();
    parent.restore();
    parent.release();
    expect(agent.jobQueue.length).toBe(1);
    loop.runOnce();
    expect(events).toEqual(["microtask"]);
  });
});

it("does not rewind consumed callback state or job capture arrays", async () => {
  await withQueue(({ api, loop, createJob, events }) => {
    const capturedValues = [api.Value("before")];
    const job = { ...createJob("consumed"), callerRealm: new api.ManagedRealm(), capturedValues };
    loop.enqueue("timers", job);
    const checkpoint = loop.captureQueue();
    loop.runOnce();
    capturedValues.push(api.Value("unowned"));
    checkpoint.restore();
    checkpoint.release();
    expect(capturedValues.map((value) => value.stringValue())).toEqual(["before", "unowned"]);
    loop.runOnce();
    expect(events).toEqual(["consumed", "consumed"]);
  });
});

it.each(["automatic", "async", "running"])(
  "rejects %s capture without changing queues",
  async (mode) => {
    await withQueue(({ loop, createJob, events }) => {
      let cancel = () => {};
      if (mode === "automatic") loop.run("automatic");
      if (mode === "async")
        loop.enqueueAsync("timers", createJob("pending"), (_enqueue, cancelPending) => {
          cancel = cancelPending;
        });
      if (mode === "running") {
        const job = createJob("running");
        loop.enqueue("timers", {
          ...job,
          job: () => {
            expect(() => loop.captureQueue()).toThrow(
              "idle manual event loop without pending async jobs",
            );
            return job.job();
          },
        });
        loop.runOnce();
        expect(events).toEqual(["running"]);
      } else
        expect(() => loop.captureQueue()).toThrow(
          "idle manual event loop without pending async jobs",
        );
      cancel();
      loop.run("manual");
      const checkpoint = loop.captureQueue();
      checkpoint.release();
    });
  },
);

it("can release after async registration makes restoration unsupported", async () => {
  await withQueue(({ loop, createJob }) => {
    const checkpoint = loop.captureQueue();
    let cancel = () => {};
    loop.enqueueAsync("timers", createJob("pending"), (_enqueue, cancelPending) => {
      cancel = cancelPending;
    });
    expect(checkpoint.restore).toThrow("idle manual event loop without pending async jobs");
    checkpoint.release();
    cancel();
    loop.captureQueue().release();
  });
});

it.each(["queued-map", "type-record", "type-set", "accessor", "frozen-record", "set-method"])(
  "preflights %s changes before restoring any storage",
  async (change) => {
    await withQueue(({ loop, createJob }) => {
      loop.enqueue("timers", createJob("saved"));
      const checkpoint = loop.captureQueue();
      const queuedJobs = Object.getOwnPropertyDescriptor(loop, "queuedJobs")?.value;
      const jobsByType = Object.getOwnPropertyDescriptor(loop, "jobsByType")?.value;
      const branch = createJob("branch");
      loop.enqueue("branch", branch);
      let getterCalls = 0;
      if (change === "queued-map") Object.defineProperty(loop, "queuedJobs", { value: new Map() });
      if (change === "type-record")
        Object.defineProperty(loop, "jobsByType", { value: Object.create(null) });
      if (change === "type-set") jobsByType.timers = new Set();
      if (change === "accessor")
        Object.defineProperty(jobsByType, "timers", {
          configurable: true,
          get: () => {
            getterCalls++;
            return new Set();
          },
        });
      if (change === "frozen-record") Object.freeze(jobsByType);
      if (change === "set-method")
        jobsByType.timers.add = () => {
          throw Error("Must not call override");
        };
      expect(checkpoint.restore).toThrow(
        change === "type-set"
          ? "type queue identity changed"
          : change === "accessor" || change === "set-method"
            ? "canonical type queues"
            : "storage changed",
      );
      expect(queuedJobs.has(branch)).toBe(true);
      expect(getterCalls).toBe(0);
      checkpoint.release();
    });
  },
);

it("rejects a storage accessor during capture without invoking it", async () => {
  await withQueue(({ loop }) => {
    let getterCalls = 0;
    Object.defineProperty(loop, "queuedJobs", {
      get: () => {
        getterCalls++;
        return new Map();
      },
    });
    expect(() => loop.captureQueue()).toThrow("storage changed");
    expect(getterCalls).toBe(0);
  });
});

it("checks Agent ownership and debugger preview", async () => {
  await withQueue(({ api, agent, loop }) => {
    const checkpoint = loop.captureQueue();
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      expect(() => loop.captureQueue()).toThrow("another Agent");
      expect(checkpoint.restore).toThrow("another Agent");
      expect(checkpoint.release).toThrow("another Agent");
    } finally {
      api.setSurroundingAgent(agent);
    }
    agent.debugger_scopePreview(() => {
      expect(() => loop.captureQueue()).toThrow("debugger preview");
      expect(checkpoint.restore).toThrow("debugger preview");
    });
    checkpoint.release();
  });
});

it("roots saved job references until release, without retaining discarded branch jobs", async () => {
  await withQueue(({ api, agent, loop }) => {
    const realm = new api.ManagedRealm();
    const result = api.EnsureCompletion(
      realm.evaluateScriptSkipDebugger(`
      var saved = { value: 7 };
      var branch = { value: 9 };
      var savedReference = new WeakRef(saved);
      var branchReference = new WeakRef(branch);
      [saved, branch];
    `),
    );
    if (result.Type !== "normal" || !(result.Value instanceof api.ObjectValue))
      throw Error("Expected array");
    const saved = result.Value.properties.get("0")?.Value;
    const branch = result.Value.properties.get("1")?.Value;
    if (!saved || !branch) throw Error("Expected values");
    const savedJob = {
      queueName: "saved",
      callerRealm: realm,
      callerScriptOrModule: null,
      capturedValues: [saved],
      job: () => api.GetValue(api.Value.undefined),
    };
    loop.enqueue("timers", savedJob);
    const checkpoint = loop.captureQueue();
    loop.runOnce();
    loop.enqueue("branch", { ...savedJob, capturedValues: [branch] });
    checkpoint.restore();
    loop.runOnce();
    realm.evaluateScriptSkipDebugger("saved = branch = null");
    const collect = () => {
      const pop = realm.pushTopContext();
      try {
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
      } finally {
        pop?.();
      }
    };
    collect();
    const observe = () => {
      const result = api.EnsureCompletion(
        realm.evaluateScriptSkipDebugger(
          "JSON.stringify([!!savedReference.deref(), !!branchReference.deref()])",
        ),
      );
      if (result.Type !== "normal" || !(result.Value instanceof api.JSStringValue))
        throw Error("Expected observation");
      return result.Value.stringValue();
    };
    expect(observe()).toBe("[true,false]");
    checkpoint.restore();
    checkpoint.release();
    loop.runOnce();
    collect();
    expect(observe()).toBe("[false,false]");
  });
});

it("captures inside an evaluation owner without granting permission for host effects", async () => {
  await withQueue(({ api, agent, loop, createJob }) => {
    const realm = new api.ManagedRealm();
    const pop = realm.pushTopContext();
    try {
      api.X(
        api.CreateDataPropertyOrThrow(
          realm.GlobalObject,
          "enabled",
          api.BooleanValue.createAbstract(),
        ),
      );
      const compiled = api.EnsureCompletion(realm.compileScript("if (enabled) void 0"));
      if (compiled.Type !== "normal") throw Error("Expected script");
      agent.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected pause");
      let releaseQueue = () => {};
      const checkpoint = agent.captureEvaluation({
        capture: () => {
          const queueCheckpoint = loop.captureQueue();
          releaseQueue = queueCheckpoint.release;
          return queueCheckpoint;
        },
      });
      try {
        expect(() => loop.enqueue("timers", createJob("forbidden"))).toThrow(
          "Host effects are unsupported during evaluation checkpoints",
        );
        checkpoint.restore();
        expect(
          agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: false,
            },
          }).done,
        ).toBe(true);
      } finally {
        releaseQueue();
        checkpoint.release();
      }
    } finally {
      pop?.();
    }
  });
});
