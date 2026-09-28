import type {
  Agent,
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
  method: "log" | "warn" | "error";
  arguments: Value[];
}

interface RuntimeFailure {
  error: unknown;
}

const consoleMethods: ConcreteConsoleEntry["method"][] = ["log", "warn", "error"];

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
  private readonly timers = new Set<number>();

  constructor(
    private readonly engine: SymbolicEngine,
    maxSteps: number,
    private readonly maxJobs: number,
    sources: ReadonlyMap<string, string>,
  ) {
    const { api } = engine;
    this.agent = new api.Agent({
      startEventLoop: false,
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
            if (operation === "reject") this.unhandledRejections.add(promise);
            else this.unhandledRejections.delete(promise);
          },
        ]),
      },
      uncaughtExceptionTrackers: new Set([(value) => this.uncaughtExceptions.push(value)]),
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
        const install = (name: string, steps: NativeSteps): void => {
          this.unwrap(
            api.CreateNonEnumerableDataPropertyOrThrow(
              this.realm.GlobalObject,
              name,
              api.CreateBuiltinFunction(steps, 0, name, []),
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
          this.timers.add(handle);
          this.agent.eventLoop.enqueue("timers", {
            queueName: "Timers",
            callerRealm: this.realm,
            callerScriptOrModule: api.GetActiveScriptOrModule(),
            job: () =>
              this.timers.delete(handle)
                ? api.Call(
                    callback,
                    api.Value.undefined,
                    args.map((value) => value ?? api.Value.undefined),
                  )
                : api.GetValue(api.Value.undefined),
          });
          return api.Value(handle);
        });
        install("clearTimeout", ([handle]) => {
          if (handle && handle !== api.Value.undefined && handle.type !== "Number")
            throw new ConcreteRuntimeError("Only numeric timer handles are supported");
          if (handle?.type === "Number") this.timers.delete(handle.value);
          return api.Value.undefined;
        });
        install("queueMicrotask", ([callback]) => {
          if (!callback || !api.IsCallable(callback))
            throw new ConcreteRuntimeError("Only callable microtask callbacks are supported");
          this.agent.jobQueue.enqueueGenericJob({
            queueName: "Microtasks",
            callerRealm: this.realm,
            callerScriptOrModule: api.GetActiveScriptOrModule(),
            job: () => api.Call(callback, api.Value.undefined, []),
          });
          return api.Value.undefined;
        });
        const consoleObject = api.OrdinaryObjectCreate(this.realm.Intrinsics["%Object.prototype%"]);
        for (const method of consoleMethods) {
          const callback = api.CreateBuiltinFunction(
            (args) => {
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

  private countJob = (): void => {
    if (++this.jobs > this.maxJobs)
      throw new ConcreteRuntimeError("Concrete job budget exceeded; runtime cannot continue");
  };

  private unwrap = <Result>(completion: PlainCompletion<Result>): Result => {
    if (completion instanceof this.engine.api.ThrowCompletion)
      throw new ConcreteGuestError(completion.Value);
    return completion instanceof this.engine.api.NormalCompletion ? completion.Value : completion;
  };

  private withAgent = <Result>(run: () => Result): Result => {
    if (this.isDisposed) throw new ConcreteRuntimeError("Concrete runtime is disposed");
    if (this.failure) throw this.failure.error;
    const { api } = this.engine;
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(this.agent);
    try {
      return run();
    } catch (error) {
      if (!(error instanceof ConcreteGuestError)) this.failure = { error };
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
    this.isDisposed = true;
    this.timers.clear();
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
