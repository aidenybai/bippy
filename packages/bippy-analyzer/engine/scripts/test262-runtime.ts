import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Agent,
  ManagedRealm,
  ThrowCompletion,
  NormalCompletion,
  ObjectValue,
  JSStringValue,
  Get,
  Value,
  skipDebugger,
  setSurroundingAgent,
  surroundingAgent,
  createTest262Intrinsics,
  runSingleJobInQueue,
  type HostPromiseRejectionTracker,
  type PromiseObject,
  AbstractModuleRecord,
  CreateBuiltinFunction,
  PerformPromiseThen,
} from "#engine";
import {
  getUnsupportedReason,
  test262JobLimit,
  type TestMetadata,
  type TestOutcome,
} from "./test262-input.js";
import { Test262ModuleError, Test262Modules } from "./test262-modules.js";

const executeVariant = (
  directory: string,
  source: string,
  metadata: TestMetadata,
  mode: string,
  modules: Test262Modules,
): TestOutcome => {
  const unsupported = getUnsupportedReason("", metadata);
  if (unsupported) return { status: "unsupported", detail: unsupported };
  const isAsync = metadata.flags.includes("async");
  const isModule = metadata.flags.includes("module");
  if (isModule !== (mode === "module"))
    return { status: "harness-error", detail: "Module flag/mode mismatch" };
  let completions = 0;
  let asyncFailure: string | undefined;
  const rejectedPromises = new Set<PromiseObject>();
  const trackRejection: HostPromiseRejectionTracker = (promise, operation) => {
    if (operation === "reject") rejectedPromises.add(promise);
    else rejectedPromises.delete(promise);
  };
  let nodes = 0;
  const agent = new Agent({
    startEventLoop: false,
    supportedImportAttributes: ["type"],
    hostHooks: {
      HostPromiseRejectionTrackers: new Set([trackRejection]),
      HostLoadImportedModule: modules.load,
    },
    onNodeEvaluation: () => {
      if (++nodes > 2_000_000) throw new Error("Test262 node budget exhausted");
    },
  });
  const previous = surroundingAgent;
  setSurroundingAgent(agent);
  let phase = "harness";
  try {
    const realm = new ManagedRealm();
    const errorName = (value: Value): string => {
      if (!(value instanceof ObjectValue)) return value.type;
      const pop = realm.pushTopContext();
      try {
        const constructor = skipDebugger(Get(value, Value("constructor")));
        if (!(constructor instanceof ObjectValue)) return "UnknownError";
        const name = skipDebugger(Get(constructor, Value("name")));
        return name instanceof JSStringValue ? name.stringValue() : "UnknownError";
      } finally {
        pop?.();
      }
    };
    const withContext = <Result>(run: () => Result): Result => {
      const pop = realm.pushTopContext();
      const result = run();
      pop?.();
      return result;
    };
    let jobs = 0;
    const drainJobs = (): TestOutcome | undefined => {
      while (agent.jobQueue.length > 0 && asyncFailure === undefined && completions <= 1) {
        if (++jobs > test262JobLimit)
          return { status: "incomplete", detail: "Test262 job budget exhausted" };
        const job = agent.jobQueue.shift();
        if (!job) throw new Error("Missing Test262 job");
        let isFinished = false;
        let jobError: Value | undefined;
        runSingleJobInQueue(
          job,
          (error) => {
            jobError = error;
          },
          () => {
            isFinished = true;
          },
        );
        if (!isFinished)
          return { status: "incomplete", detail: "Unexpected suspended Test262 job" };
        if (jobError !== undefined)
          return { status: "failed", detail: `Uncaught job error: ${errorName(jobError)}` };
      }
      if (asyncFailure !== undefined)
        return { status: "failed", detail: `Async failure: ${asyncFailure}` };
      if (completions > 1)
        return { status: "failed", detail: "Async completion signaled more than once" };
      return undefined;
    };
    const checkModuleError = (error: Value, stage: string): TestOutcome => {
      const name = errorName(error);
      return metadata.negative?.phase === stage && name === metadata.negative.type
        ? { status: "passed" }
        : { status: "failed", detail: `Unexpected ${stage} error: ${name}` };
    };
    const settleModule = (promise: PromiseObject, stage: string): TestOutcome | undefined => {
      withContext(() =>
        PerformPromiseThen(
          promise,
          Value.undefined,
          CreateBuiltinFunction.from(() => Value.undefined),
        ),
      );
      const outcome = drainJobs();
      if (outcome) return outcome;
      if (promise.PromiseState === "pending")
        return { status: "incomplete", detail: `Module ${stage} did not settle` };
      if (promise.PromiseState === "rejected") {
        if (promise.PromiseResult === undefined) throw new Error("Missing module rejection reason");
        return checkModuleError(promise.PromiseResult, stage);
      }
      return undefined;
    };
    phase = "parse";
    const compiled = isModule
      ? realm.compileModule(source, { specifier: modules.entry })
      : realm.compileScript(mode === "strict" ? `"use strict";\n${source}` : source, {
          specifier: modules.entry,
        });
    if (metadata.negative?.phase === "parse" || metadata.negative?.phase === "early")
      return compiled instanceof ThrowCompletion &&
        errorName(compiled.Value) === metadata.negative.type
        ? { status: "passed" }
        : { status: "failed", detail: "Expected negative compilation result" };
    if (compiled instanceof ThrowCompletion)
      return { status: "failed", detail: `Unexpected parse error: ${errorName(compiled.Value)}` };
    phase = "harness";
    createTest262Intrinsics(realm, true, (message) => {
      if (!isAsync || typeof message !== "string") return;
      if (message === "Test262:AsyncTestComplete") completions++;
      else if (message.startsWith("Test262:AsyncTestFailure:"))
        asyncFailure ??= message.slice("Test262:AsyncTestFailure:".length, 4000);
    });
    if (!metadata.flags.includes("raw")) {
      for (const name of [
        "assert.js",
        "sta.js",
        ...(isAsync ? ["doneprintHandle.js"] : []),
        ...metadata.includes,
      ]) {
        const result = realm.evaluateScriptSkipDebugger(
          readFileSync(resolve(directory, "harness", name), "utf8"),
        );
        if (result instanceof ThrowCompletion)
          return { status: "harness-error", detail: `${name}: ${errorName(result.Value)}` };
      }
    }
    if (completions || asyncFailure !== undefined)
      return { status: "harness-error", detail: "Async completion signaled during harness setup" };
    if (!(compiled instanceof NormalCompletion)) throw new Error("Missing compiled Test262 source");
    if (compiled.Value instanceof AbstractModuleRecord) {
      phase = "resolution";
      const module = compiled.Value;
      modules.register(NormalCompletion(module));
      const loading = settleModule(
        withContext(() => module.LoadRequestedModules()),
        "resolution",
      );
      if (loading) return loading;
      const linked = withContext(() => module.Link());
      if (linked instanceof ThrowCompletion) return checkModuleError(linked.Value, "resolution");
      if (metadata.negative?.phase === "resolution")
        return { status: "failed", detail: "Expected negative resolution result" };
      phase = "test";
      const evaluation = settleModule(
        withContext(() => skipDebugger(module.Evaluate())),
        "runtime",
      );
      if (evaluation) return evaluation;
      if (metadata.negative)
        return { status: "failed", detail: "Expected negative runtime result" };
    } else {
      phase = "test";
      const result = realm.evaluateScriptSkipDebugger(compiled.Value);
      if (metadata.negative) {
        if (
          !(result instanceof ThrowCompletion) ||
          errorName(result.Value) !== metadata.negative.type
        )
          return { status: "failed", detail: "Expected negative runtime result" };
      } else if (result instanceof ThrowCompletion)
        return { status: "failed", detail: errorName(result.Value) };
    }
    const queued = drainJobs();
    const diagnostics = rejectedPromises.size ? { unhandledRejections: rejectedPromises.size } : {};
    if (queued) return { ...queued, ...diagnostics };
    if (isAsync && completions !== 1)
      return { status: "failed", detail: "Async test did not signal completion", ...diagnostics };
    return { status: "passed", ...diagnostics };
  } catch (error) {
    if (error instanceof Test262ModuleError) return { status: error.status, detail: error.message };
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: detail.includes("budget exhausted")
        ? "incomplete"
        : phase === "harness"
          ? "harness-error"
          : "engine-error",
      detail,
    };
  } finally {
    setSurroundingAgent(previous);
  }
};

export const runTest262Variant = (
  directory: string,
  source: string,
  metadata: TestMetadata,
  mode: string,
  path = "entry.js",
): TestOutcome => {
  const modules = new Test262Modules(directory, path);
  const outcome = executeVariant(directory, source, metadata, mode, modules);
  const moduleSources = modules.getSources();
  return moduleSources.length ? { ...outcome, moduleSources } : outcome;
};
