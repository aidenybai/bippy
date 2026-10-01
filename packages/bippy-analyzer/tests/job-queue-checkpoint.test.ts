import { expect, it } from "vite-plus/test";
import type {
  Agent,
  BasicJobQueue,
  ByTypeJobQueue,
  Job,
} from "../engine/dist/declaration/index.mjs";
import { getSymbolicEngine, type SymbolicEngine } from "../src/symbolic/load-engine.js";

interface QueueFixture {
  api: SymbolicEngine["api"];
  agent: Agent;
  queue: BasicJobQueue | ByTypeJobQueue;
  createJob: (name: string) => Job;
}

const withQueue = async (kind: string, run: (fixture: QueueFixture) => void) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const queue = kind === "basic" ? new api.BasicJobQueue() : new api.ByTypeJobQueue();
  const agent = new api.Agent({ startEventLoop: false, jobQueue: queue });
  api.setSurroundingAgent(agent);
  try {
    run({
      api,
      agent,
      queue,
      createJob: (queueName) => ({
        queueName,
        callerRealm: undefined,
        callerScriptOrModule: null,
        job: () => api.GetValue(api.Value.undefined),
      }),
    });
  } finally {
    api.setSurroundingAgent(previous);
  }
};

it.each(["basic", "by-type"])(
  "restores %s membership and order without notifications",
  async (kind) => {
    await withQueue(kind, ({ queue, createJob }) => {
      const first = createJob("first");
      const second = createJob("second");
      let notifications = 0;
      queue.onNewJob.add(() => notifications++);
      queue.enqueuePromiseJob(first);
      queue.enqueueGenericJob(second);
      const checkpoint = queue.captureQueue();
      expect(checkpoint.scope).toBe("selected-job-queue-membership-v1");
      expect(checkpoint.jobCount).toBe(2);
      try {
        for (const names of [
          ["left", "right"],
          ["right", "left"],
        ]) {
          for (const name of names) {
            checkpoint.restore();
            expect(queue.shift()).toBe(first);
            const branch = createJob(name);
            queue.enqueueGenericJob(branch);
            expect(queue.shift()).toBe(second);
            expect(queue.shift()).toBe(branch);
            expect(queue.shift()).toBeUndefined();
          }
        }
        expect(notifications).toBe(6);
        checkpoint.restore();
        expect(notifications).toBe(6);
        expect(queue.shift()).toBe(first);
        expect(queue.shift()).toBe(second);
      } finally {
        checkpoint.release();
      }
      expect(checkpoint.restore).toThrow("released");
    });
  },
);

it("restores every private typed queue, including shared job membership", async () => {
  await withQueue("by-type", ({ api, queue, createJob }) => {
    if (!(queue instanceof api.ByTypeJobQueue)) throw Error("Expected typed queue");
    const shared = createJob("shared");
    const finalizer = createJob("finalizer");
    const generic = createJob("generic");
    queue.enqueuePromiseJob(shared);
    queue.enqueueTimeoutJob(shared);
    queue.enqueueFinalizationRegistryCleanupJob(finalizer);
    queue.enqueueGenericJob(generic);
    const checkpoint = queue.captureQueue();
    expect(checkpoint.jobCount).toBe(3);
    try {
      for (let iteration = 0; iteration < 2; iteration++) {
        expect(queue.shiftTimeoutJob()).toBe(shared);
        expect(queue.shiftPromiseJob()).toBe(shared);
        expect(queue.shiftFinalizationRegistryCleanupJob()).toBe(finalizer);
        expect(queue.shiftGenericJob()).toBe(generic);
        expect(queue.length).toBe(0);
        queue.enqueueTimeoutJob(createJob("discard"));
        checkpoint.restore();
      }
      expect(queue.shift()).toBe(shared);
      expect(queue.shiftTimeoutJob()).toBeUndefined();
      expect(queue.shiftPromiseJob()).toBeUndefined();
      expect(queue.shift()).toBe(finalizer);
      expect(queue.shift()).toBe(generic);
    } finally {
      checkpoint.release();
    }
  });
});

it.each(["basic", "by-type"])(
  "preserves nested %s LIFO and unowned notification membership",
  async (kind) => {
    await withQueue(kind, ({ queue, createJob }) => {
      const parent = queue.captureQueue();
      const outer = createJob("outer");
      queue.enqueueGenericJob(outer);
      const child = queue.captureQueue();
      queue.enqueueGenericJob(createJob("inner"));
      const notification = () => {};
      queue.onNewJob.add(notification);
      expect(parent.restore).toThrow("last-in-first-out");
      expect(parent.release).toThrow("last-in-first-out");
      child.restore();
      expect(queue.shift()).toBe(outer);
      expect(queue.shift()).toBeUndefined();
      child.release();
      parent.restore();
      expect(queue.length).toBe(0);
      expect(queue.onNewJob.has(notification)).toBe(true);
      parent.release();
    });
  },
);

it.each(["basic", "by-type"])(
  "checks %s Agent ownership and preview before mutation",
  async (kind) => {
    await withQueue(kind, ({ api, agent, queue, createJob }) => {
      const saved = createJob("saved");
      queue.enqueueGenericJob(saved);
      const checkpoint = queue.captureQueue();
      queue.shift();
      const branch = createJob("branch");
      queue.enqueueGenericJob(branch);
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      try {
        expect(checkpoint.restore).toThrow("another Agent");
        expect(checkpoint.release).toThrow("another Agent");
        expect(() => queue.captureQueue()).toThrow("requires the Agent queue");
      } finally {
        api.setSurroundingAgent(agent);
      }
      agent.debugger_scopePreview(() => {
        expect(() => queue.captureQueue()).toThrow("debugger preview");
        expect(checkpoint.restore).toThrow("debugger preview");
      });
      expect(queue.shift()).toBe(branch);
      checkpoint.restore();
      expect(queue.shift()).toBe(saved);
      checkpoint.release();
    });
  },
);

it.each(["basic", "by-type"])(
  "rejects replaced %s installation and permits release",
  async (kind) => {
    await withQueue(kind, ({ api, agent, queue }) => {
      const checkpoint = queue.captureQueue();
      Object.defineProperty(agent, "jobQueue", { value: new api.BasicJobQueue() });
      expect(checkpoint.restore).toThrow("requires the Agent queue");
      checkpoint.release();
    });
  },
);

it.each(["basic", "by-type"])(
  "does not rewind %s callback state or job capture contents",
  async (kind) => {
    await withQueue(kind, ({ api, queue, createJob }) => {
      let executions = 0;
      const capturedValues = [api.Value("before")];
      const job = {
        ...createJob("counter"),
        capturedValues,
        job: () => {
          executions++;
          return api.GetValue(api.Value.undefined);
        },
      };
      queue.enqueueGenericJob(job);
      const checkpoint = queue.captureQueue();
      queue.shift()?.job();
      capturedValues.push(api.Value("after"));
      checkpoint.restore();
      queue.shift()?.job();
      expect(executions).toBe(2);
      expect(capturedValues.map((value) => value.stringValue())).toEqual(["before", "after"]);
      checkpoint.release();
    });
  },
);

it("uses native Set storage rather than shadowed BasicJobQueue methods", async () => {
  await withQueue("basic", ({ queue, createJob }) => {
    const saved = createJob("saved");
    queue.enqueueGenericJob(saved);
    let calls = 0;
    for (const name of ["forEach", "clear", "add"])
      Object.defineProperty(queue, name, {
        get: () => {
          calls++;
          throw Error("Must not call override");
        },
      });
    const checkpoint = queue.captureQueue();
    queue.shift();
    checkpoint.restore();
    expect(queue.shift()).toBe(saved);
    expect(calls).toBe(0);
    checkpoint.release();
  });
});

it.each(["basic", "by-type"])(
  "roots saved %s jobs and releases discarded references",
  async (kind) => {
    await withQueue(kind, ({ api, agent, queue, createJob }) => {
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
      queue.enqueueGenericJob({
        ...createJob("saved"),
        callerRealm: realm,
        capturedValues: [saved],
      });
      const checkpoint = queue.captureQueue();
      queue.shift();
      queue.enqueueGenericJob({
        ...createJob("branch"),
        callerRealm: realm,
        capturedValues: [branch],
      });
      checkpoint.restore();
      queue.shift();
      realm.evaluateScriptSkipDebugger("saved = branch = null");
      const observe = () => {
        const pop = realm.pushTopContext();
        try {
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          const result = api.EnsureCompletion(
            realm.evaluateScriptSkipDebugger(
              "JSON.stringify([!!savedReference.deref(), !!branchReference.deref()])",
            ),
          );
          if (result.Type !== "normal" || !(result.Value instanceof api.JSStringValue))
            throw Error("Expected observation");
          return result.Value.stringValue();
        } finally {
          pop?.();
        }
      };
      expect(observe()).toBe("[true,false]");
      checkpoint.release();
      expect(observe()).toBe("[false,false]");
    });
  },
);
