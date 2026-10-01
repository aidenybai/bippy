import { expect, it } from "vite-plus/test";
import { createConcreteRuntime, type ConcreteRuntime } from "../src/concrete/runtime.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";

const getConsole = (runtime: ConcreteRuntime) =>
  runtime.consoleEntries.map((entry) => [
    entry.method,
    ...entry.arguments.map((value) => {
      if (value.type === "String" || value.type === "Number" || value.type === "Boolean")
        return value.value;
      throw Error("Expected scalar console argument");
    }),
  ]);

const collect = async (runtime: ConcreteRuntime) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(runtime.agent);
  try {
    runtime.agent.AgentRecord.KeptAlive.clear();
    api.gc();
  } finally {
    api.setSurroundingAgent(previous);
  }
};

const prefix = `
  var prefixCount = 1;
  var first = setTimeout(value => {
    console.log("first", value);
    setTimeout(() => console.log("nested"), 0);
  }, 0, "saved");
  var second = setTimeout(() => console.log("second"), 0);
  console.info("prefix");
`;

it.each([false, true])(
  "restores consumed/cancelled timers and queues in both orders (%s)",
  async (reversed) => {
    const runtime = await createConcreteRuntime();
    runtime.evaluate(prefix);
    const savedEntry = runtime.consoleEntries[0];
    const savedArguments = savedEntry?.arguments;
    const checkpoint = runtime.captureHostState();
    expect(checkpoint.scope).toBe("concrete-zero-delay-host-state-v1");
    expect(checkpoint.timerCount).toBe(2);
    let previousJobs = runtime.jobs;
    let previousSteps = runtime.steps;
    try {
      for (const cancelFirst of reversed ? [true, false] : [false, true]) {
        checkpoint.restore();
        expect(runtime.consoleEntries[0]).toBe(savedEntry);
        expect(runtime.consoleEntries[0]?.arguments).toBe(savedArguments);
        const branch = `
        clearTimeout(${cancelFirst ? "first" : "second"});
        console.log("handle", setTimeout(() => console.log("branch"), 0));
        queueMicrotask(() => console.log("microtask"));
      `;
        runtime.evaluate(branch);
        await collect(runtime);
        runtime.drainJobs();
        const native = createNativeRuntime();
        native.evaluate(prefix);
        native.evaluate(branch);
        native.drainJobs();
        expect(getConsole(runtime)).toEqual(native.consoleEntries);
        expect(runtime.readString("String(prefixCount)")).toBe("1");
        expect(runtime.jobs).toBeGreaterThan(previousJobs);
        expect(runtime.steps).toBeGreaterThan(previousSteps);
        previousJobs = runtime.jobs;
        previousSteps = runtime.steps;
      }
      checkpoint.restore();
      runtime.drainJobs();
      const native = createNativeRuntime();
      native.evaluate(prefix);
      native.drainJobs();
      expect(getConsole(runtime)).toEqual(native.consoleEntries);
    } finally {
      checkpoint.release();
      runtime.dispose();
    }
  },
);

it("preserves timer capture-array and Job identities after consumption", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  runtime.evaluate("setTimeout(value => console.log(value), 0, 7)");
  const loop = runtime.agent.eventLoop;
  if (!(loop instanceof api.WebLikeEventLoop)) throw Error("Expected web loop");
  const queuedJobs = Object.getOwnPropertyDescriptor(loop, "queuedJobs")?.value;
  const job = queuedJobs.keys().next().value;
  if (!job?.capturedValues) throw Error("Expected captured timer");
  const capturedValues = job.capturedValues;
  const savedValues = [...capturedValues];
  const checkpoint = runtime.captureHostState();
  runtime.drainJobs();
  expect(capturedValues).toHaveLength(0);
  checkpoint.restore();
  expect(queuedJobs.keys().next().value).toBe(job);
  expect(job.capturedValues).toBe(capturedValues);
  expect(capturedValues).toEqual(savedValues);
  runtime.drainJobs();
  expect(getConsole(runtime)).toEqual([["log", 7]]);
  checkpoint.release();
  runtime.dispose();
});

it("isolates branch-added timers before reusing restored handles", async () => {
  const runtime = await createConcreteRuntime();
  const checkpoint = runtime.captureHostState();
  runtime.evaluate('console.log(setTimeout(() => console.log("discarded"), 0))');
  checkpoint.restore();
  runtime.evaluate('console.log(setTimeout(() => console.log("selected"), 0))');
  runtime.drainJobs();
  expect(getConsole(runtime)).toEqual([
    ["log", 1],
    ["log", "selected"],
  ]);
  checkpoint.release();
  runtime.dispose();
});

it("restores diagnostic membership, not guest Error or Promise state", async () => {
  const runtime = await createConcreteRuntime();
  const checkpoint = runtime.captureHostState();
  runtime.evaluate('setTimeout(() => { throw new Error("branch") }, 0)');
  expect(runtime.drainJobs).toThrow("Uncaught exceptions");
  expect(runtime.uncaughtExceptions).toHaveLength(1);
  checkpoint.restore();
  expect(runtime.uncaughtExceptions).toHaveLength(0);
  runtime.evaluate('Promise.reject("branch")');
  expect(runtime.unhandledRejections.size).toBe(1);
  checkpoint.restore();
  expect(runtime.unhandledRejections.size).toBe(0);
  runtime.drainJobs();
  checkpoint.release();
  runtime.dispose();
});

it("preserves nested host LIFO and blocks disposal until release", async () => {
  const runtime = await createConcreteRuntime();
  const parent = runtime.captureHostState();
  runtime.evaluate('setTimeout(() => console.log("parent"), 0)');
  const child = runtime.captureHostState();
  expect(parent.restore).toThrow("last-in-first-out");
  expect(parent.release).toThrow("last-in-first-out");
  expect(runtime.dispose).toThrow("Cannot dispose while host checkpoints are open");
  runtime.evaluate('setTimeout(() => console.log("child"), 0)');
  child.restore();
  runtime.drainJobs();
  expect(getConsole(runtime)).toEqual([["log", "parent"]]);
  child.release();
  parent.restore();
  runtime.drainJobs();
  expect(getConsole(runtime)).toEqual([]);
  parent.release();
  expect(parent.restore).toThrow("released");
  expect(parent.release).toThrow("released");
  runtime.dispose();
});

it("preflights both queue release stacks before releasing either snapshot", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  const checkpoint = runtime.captureHostState();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(runtime.agent);
  try {
    const loop = runtime.agent.eventLoop;
    if (!(loop instanceof api.WebLikeEventLoop)) throw Error("Expected web loop");
    const nested = loop.captureQueue();
    expect(checkpoint.release).toThrow("last-in-first-out");
    nested.release();
    checkpoint.release();
  } finally {
    api.setSurroundingAgent(previous);
    runtime.dispose();
  }
});

it("keeps lifetime job budgets terminal across restoration and allows release", async () => {
  const runtime = await createConcreteRuntime({ maxJobs: 2 });
  const checkpoint = runtime.captureHostState();
  for (let iteration = 0; iteration < 2; iteration++) {
    runtime.evaluate("setTimeout(() => {}, 0)");
    checkpoint.restore();
  }
  let failure: unknown;
  try {
    runtime.evaluate("setTimeout(() => {}, 0)");
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  let restoreFailure: unknown;
  try {
    checkpoint.restore();
  } catch (error) {
    restoreFailure = error;
  }
  expect(restoreFailure).toBe(failure);
  expect(() => runtime.evaluate("1")).toThrow("job budget exceeded");
  checkpoint.release();
  runtime.dispose();
});

it("roots saved timer arguments after cancellation and releases discarded snapshots", async () => {
  const runtime = await createConcreteRuntime();
  runtime.evaluate(`
    var target = { value: 7 };
    var reference = new WeakRef(target);
    var handle = setTimeout(value => console.log(value.value), 0, target);
    target = null;
  `);
  const checkpoint = runtime.captureHostState();
  runtime.evaluate("clearTimeout(handle)");
  await collect(runtime);
  expect(runtime.readString("String(!!reference.deref())")).toBe("true");
  checkpoint.restore();
  runtime.drainJobs();
  expect(getConsole(runtime)).toEqual([["log", 7]]);
  checkpoint.release();
  await collect(runtime);
  expect(runtime.readString("String(!!reference.deref())")).toBe("false");
  runtime.dispose();
});

it.each(["console", "uncaught", "rejection"])(
  "roots live %s host diagnostics without a pushed realm context",
  async (kind) => {
    const runtime = await createConcreteRuntime();
    runtime.evaluate(`
    var target = {};
    var reference = new WeakRef(target);
    ${kind === "console" ? "console.log(target);" : kind === "uncaught" ? "setTimeout(value => { throw value }, 0, target);" : "Promise.reject(target);"}
    target = null;
  `);
    if (kind === "uncaught") expect(runtime.drainJobs).toThrow("Uncaught exceptions");
    await collect(runtime);
    expect(runtime.readString("String(!!reference.deref())")).toBe("true");
    runtime.consoleEntries.length = 0;
    runtime.uncaughtExceptions.length = 0;
    runtime.unhandledRejections.clear();
    await collect(runtime);
    expect(runtime.readString("String(!!reference.deref())")).toBe("false");
    runtime.dispose();
  },
);

it("restores host storage without rewinding guest heap or native callback state", async () => {
  const runtime = await createConcreteRuntime();
  runtime.evaluate("var count = 0; setTimeout(() => console.log(++count), 0)");
  const checkpoint = runtime.captureHostState();
  runtime.drainJobs();
  expect(getConsole(runtime)).toEqual([["log", 1]]);
  checkpoint.restore();
  runtime.drainJobs();
  expect(getConsole(runtime)).toEqual([["log", 2]]);
  checkpoint.release();
  runtime.dispose();
});
