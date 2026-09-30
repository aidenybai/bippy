import type {
  Agent,
  GCMarker,
  JobQueueCheckpoint,
  ManagedRealm,
  NativeSteps,
  PlainCompletion,
  PromiseObject,
  Value,
} from "../../engine/dist/declaration/index.mjs";
import { getSymbolicEngine, type SymbolicEngine } from "../symbolic/load-engine.js";
import { ConcreteGuestError, ConcreteRuntimeError } from "./errors.js";
import {
  createArtifactModuleLoader,
  snapshotModuleArtifacts,
  type JavaScriptModuleArtifact,
} from "./module-loader.js";

export interface ConcreteRuntimeOptions {
  maxSteps?: number;
  maxJobs?: number;
  modules?: readonly JavaScriptModuleArtifact[];
}

export interface ConcreteConsoleEntry {
  method: "log" | "info" | "warn" | "error";
  arguments: Value[];
}

export interface ConcreteHostCheckpoint {
  readonly scope: "concrete-zero-delay-host-state-v1";
  readonly timerCount: number;
  restore: () => void;
  release: () => void;
}

interface TimerState {
  handle: number;
  capturedValues: Value[];
  values: Value[];
}

interface ConsoleState {
  entry: ConcreteConsoleEntry;
  method: ConcreteConsoleEntry["method"];
  arguments: Value[];
  values: Value[];
}

interface HostState {
  nextTimer: number;
  timers: TimerState[];
  console: ConsoleState[];
  unhandled: PromiseObject[];
  uncaught: Value[];
}

interface RuntimeFailure {
  error: unknown;
}

const consoleMethods: ConcreteConsoleEntry["method"][] = ["log", "info", "warn", "error"];

export class ConcreteRuntime {
  readonly scope = "engine262-concrete-zero-delay-host-v1";
  readonly agent: Agent;
  readonly realm: ManagedRealm;
  readonly consoleEntries: ConcreteConsoleEntry[] = [];
  readonly unhandledRejections = new Set<PromiseObject>();
  readonly uncaughtExceptions: Value[] = [];
  steps = 0;
  jobs = 0;
  private isDisposed = false;
  private failure: RuntimeFailure | undefined;
  private nextTimer = 0;
  private readonly timers = new Map<number, Value[]>();
  private readonly hostCheckpoints: HostState[] = [];

  constructor(
    private readonly engine: SymbolicEngine,
    maxSteps: number,
    private readonly maxJobs: number,
    sources: ReadonlyMap<string, string>,
  ) {
    const { api } = engine;
    this.agent = new api.Agent({
      startEventLoop: false,
      hostDefinedState: this,
      onNodeEvaluation: () => {
        if (++this.steps > maxSteps)
          throw new ConcreteRuntimeError("Concrete step budget exceeded; runtime cannot continue");
      },
      hostHooks: {
        HostLoadImportedModule: api.composeModuleLoaders([
          createArtifactModuleLoader(api, sources),
        ]),
        HostPromiseRejectionTrackers: new Set([
          (promise, operation) => {
            this.agent.assertCanPerformHostEffect();
            if (operation === "reject") this.unhandledRejections.add(promise);
            else this.unhandledRejections.delete(promise);
          },
        ]),
      },
      uncaughtExceptionTrackers: new Set([
        (value) => {
          this.agent.assertCanPerformHostEffect();
          this.uncaughtExceptions.push(value);
        },
      ]),
    });
    this.agent.jobQueue.onNewJob.add(this.countJob);
    this.realm = this.withAgent(
      () =>
        new api.ManagedRealm({
          resolverCache: new api.ModuleCache(),
          getImportMetaProperties: (specifier) => {
            if (typeof specifier !== "string")
              throw new ConcreteRuntimeError("Missing module artifact identity");
            return [{ Key: api.Value("url"), Value: api.Value(specifier) }];
          },
        }),
    );
    this.withAgent(() => {
      const pop = this.realm.pushTopContext();
      try {
        const install = (name: string, steps: OmitThisParameter<NativeSteps>): void => {
          this.unwrap(
            api.CreateNonEnumerableDataPropertyOrThrow(
              this.realm.GlobalObject,
              name,
              api.CreateBuiltinFunction(
                (...parameters) => {
                  this.agent.assertCanPerformHostEffect();
                  return steps(...parameters);
                },
                0,
                name,
                [],
              ),
            ),
          );
        };
        install("setTimeout", ([callback, delay, ...args]) => {
          if (!callback || !api.IsCallable(callback))
            throw new ConcreteRuntimeError("Only callable timer callbacks are supported");
          if (
            delay &&
            delay !== api.Value.undefined &&
            (delay.type !== "Number" || delay.value !== 0)
          )
            throw new ConcreteRuntimeError("Only numeric zero-delay timers are supported");
          this.countJob();
          const handle = ++this.nextTimer;
          const capturedValues = [callback, ...args.map((value) => value ?? api.Value.undefined)];
          this.timers.set(handle, capturedValues);
          this.agent.eventLoop.enqueue("timers", {
            queueName: "Timers",
            callerRealm: this.realm,
            callerScriptOrModule: api.GetActiveScriptOrModule(),
            capturedValues,
            job: () => {
              if (!this.timers.delete(handle)) return api.GetValue(api.Value.undefined);
              const [scheduledCallback = api.Value.undefined, ...scheduledArguments] =
                capturedValues;
              capturedValues.length = 0;
              return api.Call(scheduledCallback, api.Value.undefined, scheduledArguments);
            },
          });
          return api.Value(handle);
        });
        install("clearTimeout", ([handle]) => {
          if (handle && handle !== api.Value.undefined && handle.type !== "Number")
            throw new ConcreteRuntimeError("Only numeric timer handles are supported");
          if (handle?.type === "Number") this.cancelTimer(handle.value);
          return api.Value.undefined;
        });
        install("queueMicrotask", ([callback]) => {
          if (!callback || !api.IsCallable(callback))
            throw new ConcreteRuntimeError("Only callable microtask callbacks are supported");
          this.agent.jobQueue.enqueueGenericJob({
            queueName: "Microtasks",
            callerRealm: this.realm,
            callerScriptOrModule: api.GetActiveScriptOrModule(),
            capturedValues: [callback],
            job: () => api.Call(callback, api.Value.undefined, []),
          });
          return api.Value.undefined;
        });
        const consoleObject = api.OrdinaryObjectCreate(this.realm.Intrinsics["%Object.prototype%"]);
        for (const method of consoleMethods) {
          const callback = api.CreateBuiltinFunction(
            (args) => {
              this.agent.assertCanPerformHostEffect();
              this.consoleEntries.push({
                method,
                arguments: args.map((value) => value ?? api.Value.undefined),
              });
              return api.Value.undefined;
            },
            0,
            method,
            [],
          );
          this.unwrap(api.CreateNonEnumerableDataPropertyOrThrow(consoleObject, method, callback));
        }
        this.unwrap(
          api.CreateNonEnumerableDataPropertyOrThrow(
            this.realm.GlobalObject,
            "console",
            consoleObject,
          ),
        );
        this.unwrap(
          api.CreateNonEnumerableDataPropertyOrThrow(
            this.realm.GlobalObject,
            "global",
            this.realm.GlobalObject,
          ),
        );
      } finally {
        pop?.();
      }
    });
  }

  mark = (marker: GCMarker): void => {
    marker(this.realm);
    for (const values of this.timers.values()) marker(values);
    for (const entry of this.consoleEntries) marker(entry.arguments);
    for (const promise of this.unhandledRejections) marker(promise);
    marker(this.uncaughtExceptions);
    for (const state of this.hostCheckpoints) {
      for (const timer of state.timers) marker(timer.values);
      for (const entry of state.console) marker(entry.values);
      marker(state.unhandled);
      marker(state.uncaught);
    }
  };

  captureHostState = (): ConcreteHostCheckpoint =>
    this.withAgent(() => {
      const { api } = this.engine;
      const { jobQueue, eventLoop } = this.agent;
      if (!(jobQueue instanceof api.BasicJobQueue) && !(jobQueue instanceof api.ByTypeJobQueue))
        throw new ConcreteRuntimeError("Host checkpoints require a builtin job queue");
      if (!(eventLoop instanceof api.WebLikeEventLoop))
        throw new ConcreteRuntimeError("Host checkpoints require the web event loop");
      const state: HostState = {
        nextTimer: this.nextTimer,
        timers: Array.from(this.timers, ([handle, capturedValues]) => ({
          handle,
          capturedValues,
          values: capturedValues.slice(),
        })),
        console: this.consoleEntries.map((entry) => ({
          entry,
          method: entry.method,
          arguments: entry.arguments,
          values: entry.arguments.slice(),
        })),
        unhandled: Array.from(this.unhandledRejections),
        uncaught: this.uncaughtExceptions.slice(),
      };
      const macrotasks = eventLoop.captureQueue();
      let microtasks: JobQueueCheckpoint;
      try {
        microtasks = jobQueue.captureQueue();
      } catch (error) {
        macrotasks.release();
        throw error;
      }
      this.hostCheckpoints.push(state);
      let isReleased = false;
      const assertActive = (): void => {
        if (isReleased) throw new ConcreteRuntimeError("Host checkpoint is released");
        if (this.hostCheckpoints.at(-1) !== state)
          throw new ConcreteRuntimeError("Host checkpoints require last-in-first-out access");
      };
      return {
        scope: "concrete-zero-delay-host-state-v1",
        timerCount: state.timers.length,
        restore: () => {
          assertActive();
          this.withAgent(() => {
            microtasks.assertActive();
            macrotasks.assertActive();
            microtasks.restore();
            macrotasks.restore();
            for (const values of this.timers.values()) values.length = 0;
            this.timers.clear();
            for (const timer of state.timers) {
              timer.capturedValues.length = 0;
              for (const value of timer.values) timer.capturedValues.push(value);
              this.timers.set(timer.handle, timer.capturedValues);
            }
            this.nextTimer = state.nextTimer;
            this.consoleEntries.length = 0;
            for (const saved of state.console) {
              saved.arguments.length = 0;
              for (const value of saved.values) saved.arguments.push(value);
              saved.entry.method = saved.method;
              saved.entry.arguments = saved.arguments;
              this.consoleEntries.push(saved.entry);
            }
            this.unhandledRejections.clear();
            for (const promise of state.unhandled) this.unhandledRejections.add(promise);
            this.uncaughtExceptions.length = 0;
            for (const value of state.uncaught) this.uncaughtExceptions.push(value);
          });
        },
        release: () => {
          assertActive();
          this.withAgent(() => {
            microtasks.assertActive();
            macrotasks.assertActive();
            microtasks.release();
            macrotasks.release();
            this.hostCheckpoints.pop();
            state.timers.length = 0;
            state.console.length = 0;
            state.unhandled.length = 0;
            state.uncaught.length = 0;
            isReleased = true;
          }, true);
        },
      };
    });

  private cancelTimer = (handle: number): void => {
    const capturedValues = this.timers.get(handle);
    if (capturedValues) capturedValues.length = 0;
    this.timers.delete(handle);
  };

  private countJob = (): void => {
    if (++this.jobs > this.maxJobs)
      throw new ConcreteRuntimeError("Concrete job budget exceeded; runtime cannot continue");
  };

  private unwrap = <Result>(completion: PlainCompletion<Result>): Result => {
    if (completion instanceof this.engine.api.ThrowCompletion)
      throw new ConcreteGuestError(completion.Value);
    return completion instanceof this.engine.api.NormalCompletion ? completion.Value : completion;
  };

  private withAgent = <Result>(run: () => Result, allowUnavailable = false): Result => {
    if (!allowUnavailable && this.isDisposed)
      throw new ConcreteRuntimeError("Concrete runtime is disposed");
    if (!allowUnavailable && this.failure) throw this.failure.error;
    const { api } = this.engine;
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(this.agent);
    try {
      return run();
    } catch (error) {
      if (!(error instanceof ConcreteGuestError)) this.failure ??= { error };
      throw error;
    } finally {
      api.setSurroundingAgent(previous);
    }
  };

  evaluate = (source: string, specifier?: string): Value =>
    this.withAgent(() => this.unwrap(this.realm.evaluateScriptSkipDebugger(source, { specifier })));

  readString = (source: string): string => {
    const value = this.evaluate(source);
    if (value.type !== "String")
      throw new ConcreteRuntimeError("Expected a guest string observation");
    return value.value;
  };

  drainJobs = (): void => {
    this.withAgent(() => this.agent.eventLoop.runOnce());
    if (this.uncaughtExceptions.length || this.unhandledRejections.size)
      throw new ConcreteRuntimeError(
        "Uncaught exceptions or unhandled rejections during job draining",
      );
  };

  dispose = (): void => {
    this.agent.assertCanPerformHostEffect();
    if (this.hostCheckpoints.length)
      throw new ConcreteRuntimeError("Cannot dispose while host checkpoints are open");
    this.isDisposed = true;
    for (const handle of this.timers.keys()) this.cancelTimer(handle);
  };
}

export const createConcreteRuntime = async (
  options: ConcreteRuntimeOptions = {},
): Promise<ConcreteRuntime> => {
  const maxSteps = options.maxSteps ?? 2_000_000;
  const maxJobs = options.maxJobs ?? 512;
  if (![maxSteps, maxJobs].every((limit) => Number.isSafeInteger(limit) && limit > 0))
    throw new ConcreteRuntimeError("Concrete budgets must be positive safe integers");
  const sources = snapshotModuleArtifacts(options.modules ?? []);
  const engine = await getSymbolicEngine();
  return new ConcreteRuntime(engine, maxSteps, maxJobs, sources);
};
