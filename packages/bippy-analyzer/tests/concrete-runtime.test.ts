import { expect, it } from "vitest";
import { createConcreteRuntime, ConcreteGuestError, ConcreteRuntimeError } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

it("delegates microtask checkpoints and FIFO tasks to the engine event loop", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      const events = ["script"];
      setTimeout(() => {
        events.push("timer");
        Promise.resolve().then(() => events.push("timer-promise"));
        queueMicrotask(() => events.push("timer-microtask"));
      }, 0);
      setTimeout((value) => events.push(value), 0, "second-timer");
      Promise.resolve().then(() => events.push("promise"));
      queueMicrotask(() => events.push("microtask"));
    `);
    expect(runtime.readString("JSON.stringify(events)")).toBe('["script"]');
    runtime.drainJobs();
    expect(JSON.parse(runtime.readString("JSON.stringify(events)"))).toEqual([
      "script",
      "promise",
      "microtask",
      "timer",
      "timer-promise",
      "timer-microtask",
      "second-timer",
    ]);
    expect(runtime.jobs).toBe(6);
  } finally {
    runtime.dispose();
  }
});

it("cancels timers without running their callbacks", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      let result = "untouched";
      const handle = setTimeout(() => { result = "wrong"; });
      clearTimeout(handle);
      clearTimeout(handle);
      clearTimeout(999);
      setTimeout(() => { result = "done"; }, -0);
    `);
    runtime.drainJobs();
    expect(runtime.readString("result")).toBe("done");
  } finally {
    runtime.dispose();
  }
});

it("retains console values without reading getters or coercing objects", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      const value = { get message() { throw "observed getter"; }, toString() { throw "coerced"; } };
      console.log(value, undefined); console.warn(value); console.error(value);
    `);
    expect(runtime.consoleEntries.map((entry) => entry.method)).toEqual(["log", "warn", "error"]);
    expect(runtime.consoleEntries[0].arguments[0]).toBe(runtime.evaluate("value"));
    expect(runtime.consoleEntries[0].arguments[1].type).toBe("Undefined");
  } finally {
    runtime.dispose();
  }
});

it("retains all uncaught task errors and rejected promises", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      queueMicrotask(() => { throw "microtask"; });
      setTimeout(() => { throw "timer"; });
      Promise.reject("rejection");
    `);
    expect(() => runtime.drainJobs()).toThrow("Uncaught exceptions or unhandled rejections");
    expect(
      runtime.uncaughtExceptions.map((value) => value.type === "String" && value.value),
    ).toEqual(["microtask", "timer"]);
    expect(runtime.unhandledRejections.size).toBe(1);
  } finally {
    runtime.dispose();
  }
});

it("removes rejections handled before the observation checkpoint", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(
      `const promise = Promise.reject("handled"); queueMicrotask(() => promise.catch(() => {}));`,
    );
    runtime.drainJobs();
    expect(runtime.unhandledRejections.size).toBe(0);
  } finally {
    runtime.dispose();
  }
});

it.each([
  "throw undefined",
  "throw null",
  "throw 'failure'",
  "throw new Error('failure')",
  "const =",
])("preserves guest failure and restores the agent: %s", async (source) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const runtime = await createConcreteRuntime();
  try {
    expect(() => runtime.evaluate(source)).toThrow(ConcreteGuestError);
    expect(api.surroundingAgent).toBe(previous);
    expect(runtime.agent.executionContextStack).toHaveLength(0);
    expect(runtime.readString("'still usable'")).toBe("still usable");
  } finally {
    runtime.dispose();
  }
});

it.each([
  "setTimeout(() => {}, 1)",
  "setTimeout(() => {}, '0')",
  "setTimeout('code')",
  "queueMicrotask(0)",
  "clearTimeout('1')",
])("fails closed on unsupported host calls: %s", async (source) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const runtime = await createConcreteRuntime();
  try {
    expect(() => runtime.evaluate(`try { ${source} } catch (error) {}`)).toThrow(
      ConcreteRuntimeError,
    );
    expect(() => runtime.evaluate("'cannot resume'")).toThrow(ConcreteRuntimeError);
    expect(api.surroundingAgent).toBe(previous);
  } finally {
    runtime.dispose();
  }
});

it.each([
  "while (true) {}",
  "const again = () => queueMicrotask(again); queueMicrotask(again)",
  "const again = () => setTimeout(again); setTimeout(again)",
])("bounds work and rejects continuation after exhaustion: %s", async (source) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const runtime = await createConcreteRuntime({ maxSteps: 100, maxJobs: 3 });
  try {
    expect(() => {
      runtime.evaluate(source);
      runtime.drainJobs();
    }).toThrow(/budget exceeded/);
    expect(() => runtime.evaluate("0")).toThrow(/budget exceeded/);
    expect(() => runtime.drainJobs()).toThrow(/budget exceeded/);
    expect(api.surroundingAgent).toBe(previous);
  } finally {
    runtime.dispose();
  }
});

it("isolates realms, jobs, and disposal across overlapping factory calls", async () => {
  const [first, second] = await Promise.all([createConcreteRuntime(), createConcreteRuntime()]);
  try {
    first.evaluate("globalThis.name = 'first'; setTimeout(() => { name += '-task' });");
    second.evaluate("globalThis.name = 'second'; setTimeout(() => { name += '-task' });");
    second.drainJobs();
    expect(first.readString("name")).toBe("first");
    expect(second.readString("name")).toBe("second-task");
    first.dispose();
    first.dispose();
    expect(() => first.drainJobs()).toThrow("disposed");
    expect(() => first.evaluate("0")).toThrow("disposed");
    expect(second.readString("name")).toBe("second-task");
  } finally {
    first.dispose();
    second.dispose();
  }
});

it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid budgets: %s",
  async (limit) => {
    await expect(createConcreteRuntime({ maxSteps: limit })).rejects.toThrow(
      "positive safe integers",
    );
    await expect(createConcreteRuntime({ maxJobs: limit })).rejects.toThrow(
      "positive safe integers",
    );
  },
);

it("snapshots budgets before loading and rejects non-string observations", async () => {
  const options = { maxSteps: 1 };
  const pending = createConcreteRuntime(options);
  options.maxSteps = 100;
  const runtime = await pending;
  try {
    expect(() => runtime.evaluate("1 + 2")).toThrow(/budget exceeded/);
  } finally {
    runtime.dispose();
  }
  const another = await createConcreteRuntime();
  try {
    expect(() => another.readString("42")).toThrow("Expected a guest string");
  } finally {
    another.dispose();
  }
});
