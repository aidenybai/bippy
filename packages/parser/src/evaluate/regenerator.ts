import type {
  JournaledState,
  SourceLocation,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { nativeFunction } from "../frameworks/stubs.js";
import { createErrorValue } from "./errors.js";
import { getThrowCertainty } from "./thrown.js";
import {
  FALSE_VALUE,
  getAllocationCount,
  getObjectProperty,
  isKnownList,
  objectFromRecord,
  objectValue,
  primitiveValue,
  thrownValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

/**
 * The generator runtime Babel's `regenerator` transform targets: `mark(fn)`
 * and `wrap(innerFn, outerFn, self, tryLocs)` from `@babel/runtime/helpers/regeneratorRuntime`.
 * The compiled body is a state machine over a context object (`prev`, `next`,
 * `sent`, `abrupt`, `stop`, `catch`, `finish`); its bookkeeping (run state,
 * try entries, completion records) lives in journaled native state so a fork
 * inside one step keeps one copy per path.
 */

type CompletionType = "normal" | "throw" | "return" | "break" | "continue";

interface Completion {
  type: CompletionType;
  arg: StaticValue;
}

interface TryEntry {
  tryLoc: number | "root";
  catchLoc: number | null;
  finallyLoc: number | null;
  afterLoc: number | null;
  completion: Completion;
}

type RunState = "suspendedStart" | "suspendedYield" | "executing" | "completed";

type GeneratorMethod = "next" | "throw" | "return";

interface GeneratorSnapshot {
  runState: RunState;
  method: GeneratorMethod;
  arg: StaticValue;
  rval: StaticValue;
  isDone: boolean;
  tryEntries: TryEntry[];
  isUncertain: boolean;
}

const NORMAL_COMPLETION: Completion = { type: "normal", arg: UNDEFINED_VALUE };

const ROOT_ENTRY: TryEntry = {
  tryLoc: "root",
  catchLoc: null,
  finallyLoc: null,
  afterLoc: null,
  completion: NORMAL_COMPLETION,
};

const copyEntries = (entries: TryEntry[]): TryEntry[] =>
  entries.map((entry) => ({ ...entry, completion: { ...entry.completion } }));

const areEntriesEqual = (left: TryEntry[], right: TryEntry[]): boolean =>
  left.length === right.length &&
  left.every(
    (entry, index) =>
      entry.completion.type === right[index].completion.type &&
      entry.completion.arg === right[index].completion.arg,
  );

const areSnapshotsEqual = (left: GeneratorSnapshot, right: GeneratorSnapshot): boolean =>
  left.runState === right.runState &&
  left.method === right.method &&
  left.arg === right.arg &&
  left.rval === right.rval &&
  left.isDone === right.isDone &&
  left.isUncertain === right.isUncertain &&
  areEntriesEqual(left.tryEntries, right.tryEntries);

class GeneratorState implements JournaledState<GeneratorSnapshot> {
  readonly allocation = getAllocationCount();
  current: GeneratorSnapshot;

  constructor(tryEntries: TryEntry[]) {
    this.current = {
      runState: "suspendedStart",
      method: "next",
      arg: UNDEFINED_VALUE,
      rval: UNDEFINED_VALUE,
      isDone: false,
      tryEntries,
      isUncertain: false,
    };
  }

  capture(): GeneratorSnapshot {
    return { ...this.current, tryEntries: copyEntries(this.current.tryEntries) };
  }

  restore(snapshot: GeneratorSnapshot): void {
    this.current = { ...snapshot, tryEntries: copyEntries(snapshot.tryEntries) };
  }

  join(
    snapshots: GeneratorSnapshot[],
    _reason: string,
    _location: SourceLocation | null,
    preferredPath: number,
  ): void {
    const preferred = snapshots[preferredPath] ?? snapshots[0];
    const isUncertain = snapshots.some((snapshot) => !areSnapshotsEqual(snapshot, preferred));
    this.current = {
      ...preferred,
      tryEntries: copyEntries(preferred.tryEntries),
      isUncertain: preferred.isUncertain || isUncertain,
    };
  }
}

const iterationResult = (value: StaticValue, isDone: boolean): StaticValue =>
  objectFromRecord({ value, done: primitiveValue(isDone) });

/** The value the compiled body returns to hand control back to the runtime loop. */
const CONTINUE_SENTINEL: StaticObjectValue = objectValue([]);

const containsSentinel = (value: StaticValue): boolean =>
  value === CONTINUE_SENTINEL ||
  (value.kind === "branch" && value.alternatives.some(containsSentinel)) ||
  (value.kind === "optional" && containsSentinel(value.value));

const toLocation = (value: StaticValue | undefined): number | null =>
  value?.kind === "primitive" && typeof value.value === "number" ? value.value : null;

/** `[tryLoc, catchLoc, finallyLoc, afterLoc]` lists as Babel emits them, with holes for absent locations. */
const readTryEntries = (tryLocsList: StaticValue | undefined): TryEntry[] | null => {
  const entries: TryEntry[] = [{ ...ROOT_ENTRY }];
  if (tryLocsList === undefined) return entries;
  if (!isKnownList(tryLocsList)) return null;
  for (const locations of tryLocsList.items) {
    if (!isKnownList(locations)) return null;
    const tryLoc = toLocation(locations.items[0]);
    if (tryLoc === null) return null;
    entries.push({
      tryLoc,
      catchLoc: toLocation(locations.items[1]),
      finallyLoc: toLocation(locations.items[2]),
      afterLoc: toLocation(locations.items[3]),
      completion: NORMAL_COMPLETION,
    });
  }
  return entries;
};

const runtimeError = (message: string): StaticValue =>
  thrownValue(
    "regenerator runtime throws",
    createErrorValue("Error", [primitiveValue(message)], null),
  );

class GeneratorContext {
  readonly object: StaticObjectValue;
  private readonly state: GeneratorState;

  constructor(
    private readonly innerFn: StaticValue,
    private readonly self: StaticValue | undefined,
    tryEntries: TryEntry[],
  ) {
    this.state = new GeneratorState(tryEntries);
    this.object = objectFromRecord({
      prev: primitiveValue(0),
      next: primitiveValue(0),
      sent: UNDEFINED_VALUE,
      _sent: UNDEFINED_VALUE,
      stop: nativeFunction("stop", (_args, tools) => this.stop(tools)),
      abrupt: nativeFunction("abrupt", ([type, arg], tools) => this.abrupt(type, arg, tools)),
      catch: nativeFunction("catch", ([tryLoc], tools) => this.catch(tryLoc, tools)),
      finish: nativeFunction("finish", ([finallyLoc], tools) => this.finish(finallyLoc, tools)),
      delegateYield: nativeFunction("delegateYield", () =>
        unknownValue("yield* delegation inside a compiled generator"),
      ),
    });
  }

  private update(tools: StubRenderTools, changes: Partial<GeneratorSnapshot>): void {
    tools.recordStateMutation(this.state);
    this.state.current = { ...this.state.current, ...changes };
  }

  private updateEntry(tools: StubRenderTools, entry: TryEntry, completion: Completion): void {
    this.update(tools, {
      tryEntries: this.state.current.tryEntries.map((candidate) =>
        candidate === entry ? { ...candidate, completion } : candidate,
      ),
    });
  }

  private setLocation(tools: StubRenderTools, key: "prev" | "next", value: StaticValue): void {
    tools.setProperty(this.object, key, value);
  }

  private readPrev(): number | "not-a-number" | null {
    const prev = getObjectProperty(this.object, "prev");
    if (prev.kind !== "primitive") return null;
    return typeof prev.value === "number" ? prev.value : "not-a-number";
  }

  private uncertain(reason: string): StaticValue {
    return unknownValue(`compiled generator ${reason}`);
  }

  /** `context.stop()`: the body reached `case "end"`. */
  private stop(tools: StubRenderTools): StaticValue {
    this.update(tools, { isDone: true });
    const rootRecord = this.state.current.tryEntries[0].completion;
    if (rootRecord.type === "throw") return thrownValue("generator throws", rootRecord.arg);
    return this.state.current.rval;
  }

  private complete(
    tools: StubRenderTools,
    record: Completion,
    afterLoc: number | null,
  ): StaticValue {
    if (record.type === "throw") return thrownValue("generator throws", record.arg);
    if (record.type === "break" || record.type === "continue") {
      this.setLocation(tools, "next", record.arg);
    } else if (record.type === "return") {
      this.update(tools, { rval: record.arg, arg: record.arg, method: "return" });
      this.setLocation(tools, "next", primitiveValue("end"));
    } else if (record.type === "normal" && afterLoc !== null) {
      this.setLocation(tools, "next", primitiveValue(afterLoc));
    }
    return CONTINUE_SENTINEL;
  }

  private abrupt(
    type: StaticValue | undefined,
    arg: StaticValue | undefined,
    tools: StubRenderTools,
  ): StaticValue {
    if (type?.kind !== "primitive" || !isCompletionType(type.value)) {
      return this.uncertain("abrupt completion of a dynamic kind");
    }
    const prev = this.readPrev();
    if (prev === null) return this.uncertain("abrupt completion at an uncertain location");
    const completionArg = arg ?? UNDEFINED_VALUE;
    let finallyEntry: TryEntry | null = null;
    if (prev !== "not-a-number") {
      for (const entry of [...this.state.current.tryEntries].reverse()) {
        if (entry.tryLoc !== "root" && entry.tryLoc <= prev && entry.finallyLoc !== null) {
          if (prev < entry.finallyLoc) {
            finallyEntry = entry;
            break;
          }
        }
      }
    }
    const target = toLocation(completionArg);
    if (
      finallyEntry &&
      (type.value === "break" || type.value === "continue") &&
      target !== null &&
      finallyEntry.tryLoc !== "root" &&
      finallyEntry.tryLoc <= target &&
      finallyEntry.finallyLoc !== null &&
      target <= finallyEntry.finallyLoc
    ) {
      finallyEntry = null;
    }
    const record: Completion = { type: type.value, arg: completionArg };
    if (finallyEntry) {
      this.updateEntry(tools, finallyEntry, record);
      this.update(tools, { method: "next" });
      this.setLocation(tools, "next", primitiveValue(finallyEntry.finallyLoc ?? 0));
      return CONTINUE_SENTINEL;
    }
    return this.complete(tools, record, null);
  }

  private finish(finallyLoc: StaticValue | undefined, tools: StubRenderTools): StaticValue {
    const location = toLocation(finallyLoc);
    if (location === null) return this.uncertain("finish at an uncertain location");
    for (const entry of [...this.state.current.tryEntries].reverse()) {
      if (entry.finallyLoc === location) {
        const completed = this.complete(tools, entry.completion, entry.afterLoc);
        if (completed === CONTINUE_SENTINEL) this.updateEntry(tools, entry, NORMAL_COMPLETION);
        return completed;
      }
    }
    return runtimeError("illegal finish attempt");
  }

  private catch(tryLoc: StaticValue | undefined, tools: StubRenderTools): StaticValue {
    const location = toLocation(tryLoc);
    if (location === null) return this.uncertain("catch at an uncertain location");
    for (const entry of [...this.state.current.tryEntries].reverse()) {
      if (entry.tryLoc === location) {
        const record = entry.completion;
        if (record.type !== "throw") return UNDEFINED_VALUE;
        this.updateEntry(tools, entry, NORMAL_COMPLETION);
        return record.arg;
      }
    }
    return runtimeError("illegal catch attempt");
  }

  /** Routes a throw to the innermost enclosing handler; the thrown value when none is left. */
  private dispatchException(exception: StaticValue, tools: StubRenderTools): StaticValue | null {
    if (this.state.current.isDone) return thrownValue("generator throws", exception);
    const prev = this.readPrev();
    if (prev === null) return this.uncertain("throw at an uncertain location");
    const handle = (entry: TryEntry, loc: number | "end", isCaught: boolean): null => {
      this.updateEntry(tools, entry, { type: "throw", arg: exception });
      this.setLocation(tools, "next", primitiveValue(loc));
      if (isCaught) this.update(tools, { method: "next", arg: UNDEFINED_VALUE });
      return null;
    };
    for (const entry of [...this.state.current.tryEntries].reverse()) {
      if (entry.tryLoc === "root") return handle(entry, "end", false);
      if (prev === "not-a-number" || entry.tryLoc > prev) continue;
      if (entry.catchLoc !== null && prev < entry.catchLoc)
        return handle(entry, entry.catchLoc, true);
      if (entry.finallyLoc !== null && prev < entry.finallyLoc) {
        return handle(entry, entry.finallyLoc, false);
      }
      if (entry.catchLoc === null && entry.finallyLoc === null) {
        return runtimeError("try statement without catch or finally");
      }
    }
    return null;
  }

  invoke(method: GeneratorMethod, arg: StaticValue, tools: StubRenderTools): StaticValue {
    const { runState, isUncertain } = this.state.current;
    if (isUncertain) return this.uncertain("step after its state diverged across paths");
    if (runState === "executing") return runtimeError("Generator is already running");
    if (runState === "completed") {
      return method === "throw"
        ? thrownValue("generator throws", arg)
        : iterationResult(UNDEFINED_VALUE, true);
    }
    this.update(tools, { method, arg });
    for (;;) {
      const current = this.state.current;
      if (current.method === "next") {
        tools.setProperty(this.object, "sent", current.arg);
        tools.setProperty(this.object, "_sent", current.arg);
      } else if (current.method === "throw") {
        if (current.runState === "suspendedStart") {
          this.update(tools, { runState: "completed" });
          return thrownValue("generator throws", current.arg);
        }
        const escaped = this.dispatchException(current.arg, tools);
        if (escaped) return escaped;
      } else {
        const aborted = this.abrupt(primitiveValue("return"), current.arg, tools);
        if (aborted.kind === "unknown") return aborted;
      }
      this.update(tools, { runState: "executing" });
      const returned = tools.call(this.innerFn, [this.object], this.self);
      const certainty = getThrowCertainty(returned);
      if (certainty === "never") {
        const isDone = this.state.current.isDone;
        this.update(tools, { runState: isDone ? "completed" : "suspendedYield" });
        if (returned === CONTINUE_SENTINEL) continue;
        if (containsSentinel(returned))
          return this.uncertain("step whose continuation is uncertain");
        return iterationResult(returned, isDone);
      }
      if (certainty === "maybe" || returned.kind !== "unknown" || returned.thrown === undefined) {
        this.update(tools, { runState: "completed" });
        return this.uncertain("step that may throw");
      }
      this.update(tools, { runState: "completed", method: "throw", arg: returned.thrown });
    }
  }
}

const isCompletionType = (value: unknown): value is CompletionType =>
  value === "normal" ||
  value === "throw" ||
  value === "return" ||
  value === "break" ||
  value === "continue";

const markedGeneratorFunctions = new WeakSet<StaticValue>();

const createGeneratorObject = (context: GeneratorContext): StaticValue =>
  objectFromRecord({
    next: nativeFunction("next", ([arg], tools) =>
      context.invoke("next", arg ?? UNDEFINED_VALUE, tools),
    ),
    throw: nativeFunction("throw", ([arg], tools) =>
      context.invoke("throw", arg ?? UNDEFINED_VALUE, tools),
    ),
    return: nativeFunction("return", ([arg], tools) =>
      context.invoke("return", arg ?? UNDEFINED_VALUE, tools),
    ),
  });

const wrap = ([innerFn, , self, tryLocsList]: StaticValue[]): StaticValue => {
  if (!innerFn) return unknownValue("regenerator wrap without a body");
  const tryEntries = readTryEntries(tryLocsList);
  if (!tryEntries) return unknownValue("regenerator wrap with dynamic try locations");
  const receiver = self && !(self.kind === "primitive" && self.value == null) ? self : undefined;
  return createGeneratorObject(new GeneratorContext(innerFn, receiver, tryEntries));
};

const mark = ([generatorFunction]: StaticValue[]): StaticValue => {
  if (!generatorFunction) return UNDEFINED_VALUE;
  markedGeneratorFunctions.add(generatorFunction);
  return generatorFunction;
};

const isGeneratorFunction = ([value]: StaticValue[]): StaticValue => {
  if (!value) return FALSE_VALUE;
  if (markedGeneratorFunctions.has(value)) return TRUE_VALUE;
  return value.kind === "function" && value.node.generator ? TRUE_VALUE : FALSE_VALUE;
};

/** `_regeneratorRuntime()`: the runtime object the compiled code calls `mark`/`wrap` on. */
export const regeneratorRuntime = (): StaticValue =>
  objectFromRecord({
    wrap: nativeFunction("wrap", wrap),
    mark: nativeFunction("mark", mark),
    isGeneratorFunction: nativeFunction("isGeneratorFunction", isGeneratorFunction),
  });
