import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { ConcreteRuntimeError } from "../src/concrete/errors.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

it("exports the existing identity-preserving lazy capture registration", async () => {
  const { api } = await getSymbolicEngine();
  const target = () => 7;
  const descriptors = Object.getOwnPropertyDescriptors(target);
  let reads = 0;
  const manifest = { bindings: [{ name: "value", get: () => 7 }], ambientNames: [] };
  expect(
    api.registerNativeClosure(target, () => {
      reads++;
      return manifest;
    }),
  ).toBe(target);
  expect(reads).toBe(0);
  expect(Object.getOwnPropertyDescriptors(target)).toEqual(descriptors);
  expect(api.getNativeCaptures(target)).toBe(manifest);
  expect(reads).toBe(1);
  expect(target()).toBe(7);
  expect(() => api.registerNativeClosure({}, () => manifest)).toThrow("Expected a native closure");
});

it.each(["setTimeout", "clearTimeout", "queueMicrotask"])(
  "declares the original runtime and target of %s",
  async (name) => {
    const { api } = await getSymbolicEngine();
    const runtime = await createConcreteRuntime();
    try {
      const builtin = runtime.evaluate(name);
      if (!api.isBuiltinFunctionObject(builtin)) throw Error("Expected builtin");
      const captures = api.getNativeCaptures(builtin.nativeFunction);
      expect(captures?.ambientNames).toEqual([]);
      expect(captures?.bindings.every((binding) => binding.set === undefined)).toBe(true);
      const values = new Map(captures?.bindings.map((binding) => [binding.name, binding.get()]));
      expect(values.get("[[ThisValue]]")).toBe(runtime);
      expect(values.get("api")).toBe(api);
      expect(values.get("ConcreteRuntimeError")).toBe(ConcreteRuntimeError);
      const targetCaptures = api.getNativeCaptures(values.get("steps"));
      expect(targetCaptures?.bindings.map((binding) => binding.name)).toEqual([
        "[[ThisValue]]",
        "api",
        "ConcreteRuntimeError",
        "getHostCaptures",
      ]);
      expect(targetCaptures?.bindings[0]?.get()).toBe(runtime);
      expect(api.getNativeCaptures(values.get("getHostCaptures"))?.bindings[0]?.get()).toBe(
        runtime,
      );
      expect(runtime.jobs).toBe(0);
      expect(runtime.consoleEntries).toEqual([]);
    } finally {
      runtime.dispose();
    }
  },
);

it.each(["log", "info", "warn", "error"])(
  "declares the original console method %s",
  async (method) => {
    const { api } = await getSymbolicEngine();
    const runtime = await createConcreteRuntime();
    try {
      const builtin = runtime.evaluate(`console.${method}`);
      if (!api.isBuiltinFunctionObject(builtin)) throw Error("Expected builtin");
      const captures = api.getNativeCaptures(builtin.nativeFunction);
      expect(captures?.bindings.find((binding) => binding.name === "method")?.get()).toBe(method);
      expect(captures?.bindings.find((binding) => binding.name === "[[ThisValue]]")?.get()).toBe(
        runtime,
      );
      expect(runtime.consoleEntries).toEqual([]);
      runtime.evaluate(`console.${method}(7)`);
      expect(runtime.consoleEntries[0]?.method).toBe(method);
    } finally {
      runtime.dispose();
    }
  },
);

it("declares the same timer handle and capture array that host restoration owns", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  runtime.evaluate('var handle = setTimeout(value => console.log(value), 0, "saved")');
  const queue = Object.getOwnPropertyDescriptor(runtime.agent.eventLoop, "queuedJobs")?.value;
  const job = queue.keys().next().value;
  const captures = api.getNativeCaptures(job.job);
  const values = new Map(captures?.bindings.map((binding) => [binding.name, binding.get()]));
  expect(job.job.name).toBe("job");
  expect(values.get("[[ThisValue]]")).toBe(runtime);
  expect(values.get("handle")).toBe(1);
  expect(values.get("capturedValues")).toBe(job.capturedValues);
  const snapshot = runtime.captureHostState();
  try {
    runtime.evaluate("clearTimeout(handle)");
    expect(job.capturedValues).toHaveLength(0);
    snapshot.restore();
    expect(values.get("capturedValues")).toBe(job.capturedValues);
    expect(job.capturedValues).toHaveLength(2);
    runtime.drainJobs();
    expect(runtime.consoleEntries[0]?.arguments[0]).toEqual(api.Value("saved"));
  } finally {
    snapshot.release();
    runtime.dispose();
  }
});

it("declares the original microtask callback without consuming the job", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate("var callback = () => console.log(7); queueMicrotask(callback)");
    const callback = runtime.evaluate("callback");
    const queue = runtime.agent.jobQueue;
    const job = queue.shift();
    if (!job) throw Error("Expected microtask");
    const captures = api.getNativeCaptures(job.job);
    expect(job.job.name).toBe("job");
    expect(captures?.bindings.find((binding) => binding.name === "callback")?.get()).toBe(callback);
    expect(job.capturedValues?.[0]).toBe(callback);
    expect(runtime.consoleEntries).toEqual([]);
    queue.enqueueGenericJob(job);
    runtime.drainJobs();
    expect(runtime.consoleEntries[0]?.arguments[0]).toEqual(api.Value(7));
  } finally {
    runtime.dispose();
  }
});

it("lets a rejecting continuation owner discover the concrete runtime before branching", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(runtime.agent);
  try {
    const builtin = runtime.evaluate("setTimeout");
    if (!api.isBuiltinFunctionObject(builtin)) throw Error("Expected builtin");
    api.X(
      api.CreateDataPropertyOrThrow(
        runtime.realm.GlobalObject,
        "enabled",
        api.BooleanValue.createAbstract(),
      ),
    );
    const compiled = api.EnsureCompletion(
      runtime.realm.compileScript("if (enabled) setTimeout(() => {}, 0)"),
    );
    if (compiled.Type !== "normal") throw Error("Expected script");
    runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
    const pause = runtime.agent.resumeEvaluate({
      pauseOnAbstractBoolean: true,
      noBreakpoint: true,
    });
    if (pause.done || !pause.value) throw Error("Expected decision");
    let isSeeded = false;
    let isCaptured = false;
    const rejection = Error("Concrete runtime requires an explicit host owner");
    expect(() =>
      runtime.agent.captureEvaluation({
        references: (value) => {
          if (!isSeeded) {
            isSeeded = true;
            return [builtin];
          }
          if (value === runtime) throw rejection;
          if (value === builtin) {
            const references: unknown[] = [];
            builtin.mark((reference) => references.push(reference));
            return references;
          }
          return [];
        },
        capture: () => {
          isCaptured = true;
          return { restore: () => {} };
        },
      }),
    ).toThrow(rejection);
    expect(isCaptured).toBe(false);
    expect(runtime.jobs).toBe(0);
    expect(runtime.agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
    expect(
      runtime.agent.resumeEvaluate({
        abstractBooleanDecision: {
          resume: "abstract-boolean",
          decision: pause.value,
          value: false,
        },
      }).done,
    ).toBe(true);
  } finally {
    api.setSurroundingAgent(previous);
    runtime.dispose();
  }
});

it("roots declared native captures behind a live builtin until that root is removed", async () => {
  const { api } = await getSymbolicEngine();
  const runtime = await createConcreteRuntime();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(runtime.agent);
  const pop = runtime.realm.pushTopContext();
  try {
    const target = runtime.evaluate("var target = {}; var reference = new WeakRef(target); target");
    const callback = api.registerNativeClosure(
      () => target,
      () => ({ bindings: [{ name: "target", get: () => target }], ambientNames: [] }),
    );
    const builtin = api.CreateBuiltinFunction(callback, 0, "retained", []);
    api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "retained", builtin));
    runtime.evaluate("target = null");
    runtime.agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(runtime.readString("String(reference.deref() === undefined)")).toBe("false");
    expect(api.getNativeCaptures(callback)?.bindings[0]?.get()).toBe(target);
    runtime.evaluate("retained = null");
    runtime.agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(runtime.readString("String(reference.deref() === undefined)")).toBe("true");
  } finally {
    pop?.();
    api.setSurroundingAgent(previous);
    runtime.dispose();
  }
});
