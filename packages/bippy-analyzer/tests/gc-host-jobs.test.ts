import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getCollectedReference as collect } from "./helpers/concrete-gc.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface HostJobFixture {
  name: string;
  registration: string;
  isTimer: boolean;
}

const fixtures: HostJobFixture[] = [
  {
    name: "timer closure",
    registration: `setTimeout(() => {
        seen = reference.deref() === target;
      }, 0)`,
    isTimer: true,
  },
  { name: "timer argument", registration: "setTimeout(observe, 0, target)", isTimer: true },
  {
    name: "microtask closure",
    registration: `queueMicrotask(() => {
        seen = reference.deref() === target;
      })`,
    isTimer: false,
  },
];

const getSetup = (registration: string, target: string): string => `
  var reference, handle, seen;
  function observe(value) {
    seen = reference.deref() === value;
  }
  (() => {
    const target = ${target};
    reference = new WeakRef(target);
    handle = ${registration};
  })();
`;

const cases = fixtures.flatMap((fixture) =>
  ["{}", "Symbol('target')"].map((target) => ({ ...fixture, target })),
);

it.each(cases)("retains $target through a pending $name and releases it", async (fixture) => {
  const setup = getSetup(fixture.registration, fixture.target);
  const observation = "JSON.stringify([reference.deref() !== undefined, seen])";
  const native = getNativeGcObservation(
    `
      const pending = [];
      const setTimeout = (callback, delay, ...args) =>
        pending.push(() => callback(...args));
      const queueMicrotask = (callback) => pending.push(callback);
      ${setup}
    `,
    `(pending.shift()(), ${observation})`,
  );
  expect(native).toBe("[true,true]");
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(setup);
    expect(await collect(runtime)).toBe("true");
    runtime.drainJobs();
    expect(runtime.readString(observation)).toBe(native);
    expect(await collect(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it.each(cases.filter((fixture) => fixture.isTimer))(
  "releases $target from a canceled $name before dequeuing it",
  async (fixture) => {
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(getSetup(fixture.registration, fixture.target));
      expect(await collect(runtime)).toBe("true");
      runtime.evaluate(`
        clearTimeout(handle);
        clearTimeout(handle);
      `);
      expect(await collect(runtime)).toBe("false");
      expect(runtime.jobs).toBe(1);
      runtime.drainJobs();
      expect(runtime.readString("String(seen === undefined)")).toBe("true");
    } finally {
      runtime.dispose();
    }
  },
);

it("releases disposed timer captures without executing callbacks", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(getSetup("setTimeout(observe, 0, target)", "{}"));
    expect(await collect(runtime)).toBe("true");
    runtime.dispose();
    expect(await collect(runtime)).toBe("false");
    expect(() => runtime.drainJobs()).toThrow("Concrete runtime is disposed");
  } finally {
    runtime.dispose();
  }
});

it("retains declared captures while a realm job factory runs", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  try {
    const target = runtime.evaluate(
      `
        var reference;
        (() => {
          const target = {};
          reference = new WeakRef(target);
          return target;
        })()
      `,
    );
    let wasRetained = false;
    const job = {
      queueName: "CapturedFactory",
      callerRealm: runtime.realm,
      callerScriptOrModule: null,
      capturedValues: [target],
      job: () => {
        expect(runtime.agent.runningExecutionContext.copy().HostCapturedValues).toBe(
          job.capturedValues,
        );
        runtime.agent.AgentRecord.KeptAlive.clear();
        api.gc();
        wasRetained = runtime.readString("String(reference.deref() !== undefined)") === "true";
        return api.GetValue(api.Value.undefined);
      },
    };
    runtime.agent.jobQueue.enqueueGenericJob(job);
    runtime.drainJobs();
    expect(wasRetained).toBe(true);
    expect(await collect(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it.each(["basic", "by-type", "microtask", "web", "node"])(
  "marks job captures through the %s queue path",
  async (mode) => {
    const { api } = await getSymbolicEngine();
    const previous = api.surroundingAgent;
    const agent = new api.Agent({
      startEventLoop: false,
      jobQueue: mode === "by-type" ? new api.ByTypeJobQueue() : new api.BasicJobQueue(),
      eventLoop: (owner) =>
        mode === "node"
          ? new api.NodeJSLikeEventLoop(owner)
          : mode === "web"
            ? new api.WebLikeEventLoop(owner)
            : new api.MicroTaskEventLoop(owner),
    });
    api.setSurroundingAgent(agent);
    try {
      const realm = new api.ManagedRealm();
      const result = api.EnsureCompletion(
        realm.evaluateScriptSkipDebugger(
          `
            var reference;
            (() => {
              const target = {};
              reference = new WeakRef(target);
              return target;
            })()
          `,
        ),
      );
      if (result.Type !== "normal") throw new Error("Expected a captured value");
      const job = {
        queueName: "CapturedQueue",
        capturedValues: [result.Value],
        callerRealm: realm,
        callerScriptOrModule: null,
        job: () => api.GetValue(api.Value.undefined),
      };
      agent.eventLoop.enqueue("timers", job);
      const pop = realm.pushTopContext();
      try {
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
        expect(
          api.EnsureCompletion(realm.evaluateScriptSkipDebugger("reference.deref() !== undefined"))
            .Value,
        ).toBe(api.Value.true);
      } finally {
        pop?.();
      }
      agent.eventLoop.runOnce();
      const release = realm.pushTopContext();
      try {
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
        expect(
          api.EnsureCompletion(realm.evaluateScriptSkipDebugger("reference.deref() === undefined"))
            .Value,
        ).toBe(api.Value.true);
      } finally {
        release?.();
      }
    } finally {
      api.setSurroundingAgent(previous);
    }
  },
);

it("rejects captured values without a caller realm before invoking the job", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  try {
    let wasCalled = false;
    runtime.agent.jobQueue.enqueueGenericJob({
      queueName: "MissingRealm",
      capturedValues: [runtime.evaluate("({})")],
      callerRealm: undefined,
      callerScriptOrModule: null,
      job: () => {
        wasCalled = true;
        return api.GetValue(api.Value.undefined);
      },
    });
    expect(() => runtime.drainJobs()).toThrow("Captured job values require a caller realm");
    expect(wasCalled).toBe(false);
    expect(() => runtime.evaluate("1")).toThrow("Captured job values require a caller realm");
  } finally {
    runtime.dispose();
  }
});

it.each([undefined, []])(
  "retains legacy realmless jobs with captures=%s",
  async (capturedValues) => {
    const { api } = await getSymbolicEngine();
    const runtime = await createConcreteRuntime();
    try {
      let wasCalled = false;
      runtime.agent.jobQueue.enqueueGenericJob({
        queueName: "LegacyRealm",
        capturedValues,
        callerRealm: undefined,
        callerScriptOrModule: null,
        job: () => {
          wasCalled = true;
          return api.GetValue(api.Value.undefined);
        },
      });
      runtime.drainJobs();
      expect(wasCalled).toBe(true);
    } finally {
      runtime.dispose();
    }
  },
);

it("retains a deferred host job and releases its canceled registration", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  try {
    const target = runtime.evaluate(
      `
        var reference;
        (() => {
          const target = {};
          reference = new WeakRef(target);
          return target;
        })()
      `,
    );
    let cancelPending: (() => void) | undefined;
    const job = {
      queueName: "DeferredCapture",
      callerRealm: runtime.realm,
      callerScriptOrModule: null,
      capturedValues: [target],
      job: () => api.GetValue(api.Value.undefined),
    };
    runtime.agent.eventLoop.enqueueAsync("timers", job, (_enqueue, cancel) => {
      cancelPending = cancel;
    });
    expect(await collect(runtime)).toBe("true");
    if (!cancelPending) throw new Error("Expected cancellation callback");
    cancelPending();
    expect(await collect(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});
