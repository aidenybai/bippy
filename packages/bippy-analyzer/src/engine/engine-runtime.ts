import {
  Agent,
  ManagedRealm,
  Value,
  ObjectValue,
  JSStringValue,
  NormalCompletion,
  ThrowCompletion,
  Call,
  Get,
  CreateBuiltinFunction,
  CreateNonEnumerableDataPropertyOrThrow,
  CreateDataPropertyOrThrow,
  CreateArrayFromList,
  CreateListFromArrayLike,
  OrdinaryObjectCreate,
  IsArray,
  IsCallable,
  Set as SetProperty,
  skipDebugger,
  setSurroundingAgent,
  surroundingAgent,
  runSingleJobInQueue,
  type PlainCompletion,
  type PromiseObject,
} from "#engine";
import { EngineLimitError, EngineUnsupportedError } from "./unsupported.js";
import { TimerQueue } from "../evaluate/timers.js";
import { primitiveValue } from "../evaluate/values.js";

export class EngineApplicationError extends Error {
  constructor(readonly value: Value) {
    super("engine262 application threw");
    Object.defineProperty(this, "value", { enumerable: false });
  }
}

export interface EngineMetrics {
  nodes: number;
  calls: number;
  jobs: number;
}

const unwrap = <Result>(result: PlainCompletion<Result>): Result => {
  if (result instanceof ThrowCompletion) throw new EngineApplicationError(result.Value);
  return result instanceof NormalCompletion ? result.Value : result;
};

export const getPrimitive = (
  value: Value,
): string | number | bigint | boolean | null | undefined => {
  if (value.type === "Object" || value.type === "Symbol")
    throw new Error(`Unsupported engine262 boundary value: ${value.type}`);
  return value.value;
};

export class EngineRuntime {
  readonly metrics: EngineMetrics = { nodes: 0, calls: 0, jobs: 0 };
  readonly unhandledRejections = new Set<PromiseObject>();
  readonly unsupported = new Set<string>();
  readonly agent: Agent;
  readonly realm: ManagedRealm;
  private nextTimer = 0;
  private readonly timerHandles = new Map<number, ReturnType<typeof primitiveValue>>();
  private isDisposed = false;
  private failure: Error | null = null;

  readonly backgroundErrors: unknown[] = [];

  constructor(
    maxNodes = 2_000_000,
    readonly timers = new TimerQueue(),
    private readonly useHostMicrotasks = false,
  ) {
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1)
      throw new RangeError("Engine node budget must be a positive safe integer");
    this.agent = new Agent({
      startEventLoop: false,
      hostHooks: {
        HostPromiseRejectionTrackers: new Set([
          (promise: PromiseObject, operation: "reject" | "handle") => {
            if (operation === "reject") this.unhandledRejections.add(promise);
            else this.unhandledRejections.delete(promise);
          },
        ]),
      },
      onNodeEvaluation: () => {
        if (++this.metrics.nodes > maxNodes) throw new EngineLimitError("node");
      },
    });
    this.realm = this.withAgent(() => new ManagedRealm({ name: "Bippy execution engine" }));
    this.agent.jobQueue.onNewJob.add(() =>
      this.scheduleMicrotask(() =>
        this.withAgent(() => {
          if (++this.metrics.jobs > 512) throw new EngineLimitError("job");
          const job = this.agent.jobQueue.shift();
          if (!job) throw new Error("Missing engine262 job");
          let isFinished = false;
          let failure: Value | undefined;
          runSingleJobInQueue(
            job,
            (error) => {
              failure = error;
            },
            () => {
              isFinished = true;
            },
          );
          if (failure) throw new EngineApplicationError(failure);
          if (!isFinished) throw new Error("Unexpected paused engine262 job");
        }),
      ),
    );
    this.setGlobal(
      "setTimeout",
      this.createFunction("setTimeout", ([callback, delay = Value(0), ...args]) => {
        if (!callback || !IsCallable(callback))
          throw new Error("Only callback timers are supported");
        const milliseconds = delay === Value.undefined ? 0 : getPrimitive(delay);
        if (typeof milliseconds !== "number" || milliseconds !== 0)
          throw new EngineUnsupportedError("Delayed timers require a browser clock");
        const handle = ++this.nextTimer;
        const token = primitiveValue(handle);
        this.timerHandles.set(handle, token);
        this.timers.schedule(token, () => {
          this.timerHandles.delete(handle);
          this.call(callback, args);
        });
        return Value(handle);
      }),
    );
    this.setGlobal(
      "clearTimeout",
      this.createFunction("clearTimeout", ([handle = Value.undefined]) => {
        const identifier = getPrimitive(handle);
        if (typeof identifier === "number") {
          this.timers.clear(this.timerHandles.get(identifier));
          this.timerHandles.delete(identifier);
        }
        return Value.undefined;
      }),
    );
    this.setGlobal(
      "queueMicrotask",
      this.createFunction("queueMicrotask", ([callback]) => {
        if (!callback || !IsCallable(callback)) throw new Error("Expected a microtask callback");
        this.scheduleMicrotask(() => this.call(callback, []));
        return Value.undefined;
      }),
    );
  }

  scheduleMicrotask = (callback: () => void): void => {
    if (!this.useHostMicrotasks) {
      this.timers.queueMicrotask(callback);
      return;
    }
    queueMicrotask(() => {
      if (this.isDisposed || this.failure) return;
      try {
        callback();
      } catch (error) {
        this.backgroundErrors.push(error);
      }
    });
  };

  get isFailed(): boolean {
    return this.failure !== null;
  }

  withAgent = <Result>(run: () => Result): Result => {
    if (this.isDisposed) throw new Error("Engine is disposed");
    if (this.failure) throw this.failure;
    const previous = surroundingAgent;
    setSurroundingAgent(this.agent);
    try {
      return run();
    } catch (error) {
      if (error instanceof EngineUnsupportedError) this.unsupported.add(error.message);
      if (!(error instanceof EngineApplicationError))
        this.failure =
          error instanceof Error ? error : new Error("engine262 host failed", { cause: error });
      throw error;
    } finally {
      setSurroundingAgent(previous);
    }
  };

  withRealm = <Result>(run: () => Result): Result =>
    this.withAgent(() => {
      const pop = this.realm.pushTopContext();
      try {
        return run();
      } finally {
        if (this.agent.runningExecutionContext === this.realm.topContext) pop?.();
      }
    });

  evaluate = (source: string): Value =>
    this.withAgent(() => unwrap(this.realm.evaluateScriptSkipDebugger(source)));
  call = (callback: Value, args: Value[], receiver: Value = Value.undefined): Value =>
    this.withRealm(() => {
      this.metrics.calls++;
      return unwrap(skipDebugger(Call(callback, receiver, args)));
    });
  getOwnData = (object: ObjectValue, key: string): Value | undefined =>
    this.withRealm(() =>
      "ProxyTarget" in object
        ? undefined
        : unwrap(skipDebugger(object.GetOwnProperty(Value(key))))?.Value,
    );
  get = (object: ObjectValue, key: string): Value =>
    this.withRealm(() => unwrap(skipDebugger(Get(object, key))));
  set = (object: ObjectValue, key: string, value: Value): void =>
    this.withRealm(() => {
      unwrap(skipDebugger(SetProperty(object, key, value, true)));
    });
  getObject = (value: Value): ObjectValue => {
    if (!(value instanceof ObjectValue))
      throw new EngineUnsupportedError("Expected an engine object");
    return value;
  };
  setGlobal = (name: string, value: Value): void =>
    this.withRealm(() =>
      CreateNonEnumerableDataPropertyOrThrow(this.realm.GlobalObject, name, value),
    );
  createFunction = (name: string, run: (args: Value[], receiver: Value) => Value) =>
    this.withRealm(() =>
      CreateBuiltinFunction(
        (args, { thisValue }) => {
          try {
            return run(
              args.map((argument) => argument ?? Value.undefined),
              thisValue,
            );
          } catch (error) {
            if (error instanceof EngineApplicationError) return ThrowCompletion(error.value);
            throw error;
          }
        },
        0,
        name,
        [],
      ),
    );
  createRecord = (entries: Array<[string, Value]>): ObjectValue =>
    this.withRealm(() => {
      const result = OrdinaryObjectCreate(this.realm.Intrinsics["%Object.prototype%"]);
      for (const [key, value] of entries)
        unwrap(skipDebugger(CreateDataPropertyOrThrow(result, key, value)));
      return result;
    });
  createArray = (values: Value[]): ObjectValue => this.withRealm(() => CreateArrayFromList(values));
  isArray = (value: Value): boolean => this.withRealm(() => unwrap(IsArray(value)));
  getArray = (value: Value): Value[] =>
    this.withRealm(() => {
      if (!this.isArray(value)) throw new Error("Expected an engine262 array");
      return unwrap(skipDebugger(CreateListFromArrayLike(value)));
    });
  getDataEntries = (value: Value): Array<[string, Value]> => {
    const object = this.getObject(value);
    return this.withRealm(() => {
      const entries: Array<[string, Value]> = [];
      for (const key of unwrap(skipDebugger(object.OwnPropertyKeys()))) {
        const descriptor = unwrap(skipDebugger(object.GetOwnProperty(key)));
        if (descriptor?.Enumerable && key instanceof JSStringValue)
          entries.push([key.value, this.get(object, key.value)]);
      }
      return entries;
    });
  };
  describeError = (error: unknown): string => {
    if (!(error instanceof EngineApplicationError)) return String(error);
    const value = error.value;
    if (!(value instanceof ObjectValue))
      return value.type === "Symbol" ? "Symbol throw" : String(getPrimitive(value));
    if (this.failure) return "Engine application threw an object";
    const readData = (key: string): string | undefined =>
      this.withRealm(() => {
        let object: ObjectValue | typeof Value.null = value;
        for (let depth = 0; depth < 8 && object instanceof ObjectValue; depth++) {
          if ("ProxyTarget" in object) return undefined;
          const descriptor = unwrap(skipDebugger(object.GetOwnProperty(Value(key))));
          if (descriptor)
            return descriptor.Value?.type === "String" ? descriptor.Value.value : undefined;
          object = unwrap(skipDebugger(object.GetPrototypeOf()));
        }
        return undefined;
      });
    return `${readData("name") ?? "Thrown object"}: ${readData("message") ?? ""}`;
  };
  createPrimitive = (value: unknown): Value => {
    if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    )
      return Value(value);
    throw new Error("Only scalar host data is supported at the engine262 boundary");
  };
  dispose = (): void => {
    this.isDisposed = true;
    this.agent.jobQueue.onNewJob.clear();
  };
}
