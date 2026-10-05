/*! Completion dispatch adapted from Babel regenerator-runtime, Copyright (c) 2014-present, Facebook, Inc. MIT; see licenses/babel-helpers-mit.txt. */

import {
  getNativeCaptures,
  type CapturedBinding,
  type CaptureManifest,
} from "./native-captures.js";

export interface ControlMetrics {
  framesCreated: number;
  peakFrames: number;
  tailTransfers: number;
}

export interface MeasuredExecution<Result> {
  value: Result;
  metrics: ControlMetrics;
}

let activeMetrics: ControlMetrics | undefined;
let parentFrameCount = 0;

export const measureSynchronousExecution = <Result>(
  execute: () => Result,
): MeasuredExecution<Result> => {
  const previous = activeMetrics;
  const metrics: ControlMetrics = { framesCreated: 0, peakFrames: 0, tailTransfers: 0 };
  activeMetrics = metrics;
  try {
    return { value: execute(), metrics };
  } finally {
    activeMetrics = previous;
  }
};

const recordDepth = (stack: ExecutionMachine[]): void => {
  if (activeMetrics)
    activeMetrics.peakFrames = Math.max(activeMetrics.peakFrames, parentFrameCount + stack.length);
};

interface SavedBinding {
  binding: CapturedBinding;
  value: unknown;
}

export interface ContinuationStateRoots {
  values: readonly unknown[];
  ambientNames: readonly string[];
  controlOwnedObjects: readonly object[];
}

export interface StateCheckpoint {
  restore: () => void;
}

export interface ContinuationStateOwner {
  beginCapture?: () => void;
  references?: (value: object) => readonly unknown[];
  capture: (roots: ContinuationStateRoots) => StateCheckpoint;
}

interface FrameState {
  frame: ExecutionMachine;
  previous: number;
  next: number;
  value: unknown;
  locals: Record<string, PropertyDescriptor>;
  handlers: TryEntry[];
  phase: "initial" | "suspended";
  isDone: boolean;
  operation: number;
  argument: unknown;
  delegate: object | undefined;
  method: ResumeMethod;
  boundary: object | undefined;
  normalizeResult: ((value: unknown) => unknown) | undefined;
  isCallBoundary: boolean;
  forward: ExecutionMachine | undefined;
  receiver: unknown;
  captures: CaptureManifest;
}

let isCheckpointing = false;
let isControlFrame: (value: unknown) => value is ExecutionMachine;

const validateLocals = (locals: Record<string, unknown>): Record<string, PropertyDescriptor> => {
  if (!Object.isExtensible(locals))
    throw new Error("Cannot checkpoint non-extensible frame locals");
  const descriptors = Object.getOwnPropertyDescriptors(locals);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor: PropertyDescriptor | undefined = Reflect.get(descriptors, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.configurable || !descriptor.writable)
      throw new Error("Cannot checkpoint accessor or immutable frame locals");
  }
  return descriptors;
};

export const captureControl = (
  iterator: unknown,
  owner: ContinuationStateOwner,
): StateCheckpoint => {
  if (!isControlFrame(iterator)) throw new Error("Cannot checkpoint a foreign continuation");
  if (!owner || typeof owner.capture !== "function")
    throw new Error("Control checkpoints require a state owner");
  if (activeStack || isCheckpointing)
    throw new Error("Cannot checkpoint during execution or another checkpoint");
  isCheckpointing = true;
  try {
    owner.beginCapture?.();
    const pending: unknown[] = [iterator];
    const visited = new Set<object>();
    const states: FrameState[] = [];
    const bindings: SavedBinding[] = [];
    const values: unknown[] = [];
    const ambientNames = new Set<string>();
    const controlOwnedObjects: object[] = [];
    const addValue = (value: unknown): void => {
      values.push(value);
      pending.push(value);
    };
    const addCaptures = (manifest: CaptureManifest): void => {
      for (const binding of manifest.bindings) {
        const value = binding.get();
        bindings.push({ binding, value });
        addValue(value);
      }
      for (const name of manifest.ambientNames) ambientNames.add(name);
    };
    while (pending.length) {
      const frame = pending.pop();
      if (!isObject(frame) || visited.has(frame)) continue;
      visited.add(frame);
      if (!isControlFrame(frame)) {
        const captures = getNativeCaptures(frame);
        if (captures) addCaptures(captures);
        for (const reference of owner.references?.(frame) ?? []) addValue(reference);
        continue;
      }
      const state = frame.captureControlState();
      states.push(state);
      controlOwnedObjects.push(frame, frame.l);
      for (const value of [
        state.value,
        state.argument,
        state.receiver,
        state.boundary,
        state.normalizeResult,
      ])
        addValue(value);
      for (const key of Reflect.ownKeys(state.locals))
        addValue(Reflect.get(state.locals, key).value);
      for (const handler of state.handlers) addValue(handler.argument);
      addCaptures(state.captures);
      if (state.forward) pending.push(state.forward);
      if (state.delegate) {
        if (!isControlFrame(state.delegate))
          throw new Error("Cannot checkpoint a foreign delegate");
        pending.push(state.delegate);
      }
    }
    const heap = owner.capture({ values, ambientNames: [...ambientNames], controlOwnedObjects });
    return {
      restore: () => {
        if (activeStack || isCheckpointing)
          throw new Error("Cannot restore during execution or another checkpoint");
        isCheckpointing = true;
        try {
          for (const state of states) {
            state.frame.assertCheckpointHealthy();
            state.frame.assertCheckpointShape();
            validateLocals(state.frame.l);
          }
          for (const { binding, value } of bindings) {
            if (!binding.set && !Object.is(binding.get(), value))
              throw new Error(`Read-only capture changed: ${binding.name}`);
          }
          try {
            for (const { binding, value } of bindings) binding.set?.(value);
            for (const state of states) state.frame.restoreControlState(state);
            heap.restore();
          } catch (error) {
            for (const state of states) state.frame.poisonCheckpoint(error);
            throw error;
          }
        } finally {
          isCheckpointing = false;
        }
      },
    };
  } finally {
    isCheckpointing = false;
  }
};

interface MachineContext {
  p: number;
  n: number;
  v: unknown;
  l: Record<string, unknown>;
  a: (operation: number, argument?: unknown) => unknown;
  f: (location: number) => unknown;
  d: (iterator: object, location: number) => unknown;
}

interface TryEntry {
  start: number;
  catchLocation?: number;
  finallyLocation?: number;
  afterLocation?: number;
  operation?: number;
  argument?: unknown;
}

interface YieldStep {
  kind: "yield";
  result: IteratorResult<unknown>;
}

interface DelegateStep {
  kind: "delegate";
  iterator: object;
  method: ResumeMethod;
  argument: unknown;
}

type MachineStep = YieldStep | DelegateStep;
type ResumeMethod = "next" | "throw" | "return";

const CONTINUE = Object.freeze({});
const NEXT = 0;
const THROW = 1;
const RETURN = 2;
const JUMP = 3;
const FINISH = 4;
let activeStack: ExecutionMachine[] | undefined;

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";

class TailTransfer<Result> implements IterableIterator<never, Result, unknown> {
  constructor(
    readonly boundary: object,
    readonly iterator: Iterator<unknown, Result, unknown>,
  ) {}
  next(): IteratorResult<never, Result> {
    throw new Error("Tail transfer escaped its execution machine");
  }
  [Symbol.iterator](): TailTransfer<Result> {
    return this;
  }
}

export const transferContinuation = <Result>(
  boundary: object,
  iterator: Iterator<unknown, Result, unknown>,
): IterableIterator<never, Result, unknown> => new TailTransfer(boundary, iterator);

export const markCallContinuation = (): void => {
  const frame = activeStack?.at(-1);
  if (!frame) throw new Error("Missing call continuation");
  frame.isCallBoundary = true;
};

export const markContinuationBoundary = (
  boundary: object,
  normalizeResult?: (value: unknown) => unknown,
): void => {
  if (!activeStack?.length) throw new Error("Missing function continuation");
  let index = activeStack.length - 1;
  if (!normalizeResult) while (index > 0 && activeStack[index - 1].isCallBoundary) index--;
  const frame = activeStack[index];
  frame.boundary = boundary;
  if (normalizeResult) frame.normalizeResult = normalizeResult;
};

export class ExecutionMachine
  implements IterableIterator<unknown, unknown, unknown>, MachineContext
{
  #controlBrand: undefined;
  static {
    isControlFrame = (value: unknown): value is ExecutionMachine =>
      isObject(value) && #controlBrand in value;
  }

  p = 0;
  n = 0;
  v: unknown;
  readonly l: Record<string, unknown>;
  boundary: object | undefined;
  normalizeResult: ((value: unknown) => unknown) | undefined;
  isCallBoundary = false;
  forward: ExecutionMachine | undefined;
  private readonly handlers: TryEntry[];
  private phase: "initial" | "suspended" | "running" = "initial";
  private isDone = false;
  private operation = NEXT;
  private argument: unknown;
  private delegate: object | undefined;
  private method: ResumeMethod = "next";
  private checkpointFailure: Error | undefined;

  constructor(
    private readonly execute: (context: MachineContext) => unknown,
    private readonly receiver: unknown,
    locations: ReadonlyArray<ReadonlyArray<number | undefined>> = [],
    locals: Record<string, unknown> = {},
    private readonly captureBindings?: () => CaptureManifest,
  ) {
    if (activeMetrics) activeMetrics.framesCreated++;
    this.handlers = locations.map(([start, catchLocation, finallyLocation, afterLocation]) => {
      if (start === undefined) throw new Error("Missing machine try location");
      return { start, catchLocation, finallyLocation, afterLocation };
    });
    this.l = locals;
  }

  assertCheckpointHealthy(): void {
    if (this.checkpointFailure) throw this.checkpointFailure;
  }

  poisonCheckpoint(cause: unknown): void {
    this.checkpointFailure = new Error("Control checkpoint restoration failed", { cause });
  }

  assertCheckpointShape(): void {
    if (
      Object.getPrototypeOf(this) !== ExecutionMachine.prototype ||
      ["next", "throw", "return", Symbol.iterator].some((name) => Object.hasOwn(this, name))
    )
      throw new Error("Cannot checkpoint overridden continuation methods");
  }

  captureControlState(): FrameState {
    this.assertCheckpointHealthy();
    this.assertCheckpointShape();
    if (this.phase === "running") throw new Error("Cannot checkpoint a running frame");
    if (!this.captureBindings) throw new Error("Continuation lacks capture metadata");
    return {
      frame: this,
      previous: this.p,
      next: this.n,
      value: this.v,
      locals: validateLocals(this.l),
      handlers: this.handlers.map((handler) => ({ ...handler })),
      phase: this.phase,
      isDone: this.isDone,
      operation: this.operation,
      argument: this.argument,
      delegate: this.delegate,
      method: this.method,
      boundary: this.boundary,
      normalizeResult: this.normalizeResult,
      isCallBoundary: this.isCallBoundary,
      forward: this.forward,
      receiver: this.receiver,
      captures: this.captureBindings(),
    };
  }

  restoreControlState(state: FrameState): void {
    if (state.frame !== this) throw new Error("Control checkpoint belongs to another frame");
    this.p = state.previous;
    this.n = state.next;
    this.v = state.value;
    for (const key of Reflect.ownKeys(this.l)) Reflect.deleteProperty(this.l, key);
    Object.defineProperties(this.l, state.locals);
    this.handlers.splice(
      0,
      this.handlers.length,
      ...state.handlers.map((handler) => ({ ...handler })),
    );
    this.phase = state.phase;
    this.isDone = state.isDone;
    this.operation = state.operation;
    this.argument = state.argument;
    this.delegate = state.delegate;
    this.method = state.method;
    this.boundary = state.boundary;
    this.normalizeResult = state.normalizeResult;
    this.isCallBoundary = state.isCallBoundary;
    this.forward = state.forward;
  }

  next(argument?: unknown): IteratorResult<unknown> {
    return drive(this, "next", argument);
  }
  throw(argument?: unknown): IteratorResult<unknown> {
    return drive(this, "throw", argument);
  }
  return(argument?: unknown): IteratorResult<unknown> {
    return drive(this, "return", argument);
  }
  [Symbol.iterator](): ExecutionMachine {
    return this;
  }

  a(operation: number, argument?: unknown): unknown {
    this.operation = operation;
    this.argument = argument;
    let handled = false;
    for (const entry of this.handlers) {
      if (this.isDone || this.phase === "initial" || handled) break;
      if (operation === FINISH) {
        if (entry.finallyLocation === argument) {
          handled = true;
          this.operation = entry.operation ?? JUMP;
          this.argument = entry.operation === undefined ? entry.afterLocation : entry.argument;
          entry.operation = undefined;
          entry.argument = undefined;
        }
      } else if (entry.start <= this.p) {
        if (
          operation === THROW &&
          entry.catchLocation !== undefined &&
          this.p < entry.catchLocation
        ) {
          handled = true;
          this.operation = NEXT;
          this.v = argument;
          this.n = entry.catchLocation;
        } else if (
          entry.finallyLocation !== undefined &&
          this.p < entry.finallyLocation &&
          (operation < JUMP ||
            (typeof argument === "number" &&
              (entry.start > argument || argument > entry.finallyLocation)))
        ) {
          handled = true;
          entry.operation = operation;
          entry.argument = argument;
          this.n = entry.finallyLocation;
          this.operation = NEXT;
        }
      }
    }
    if (handled || operation > THROW) return CONTINUE;
    this.isDone = true;
    throw argument;
  }

  f(location: number): unknown {
    return this.a(FINISH, location);
  }
  d(iterator: object, location: number): unknown {
    this.delegate = iterator;
    this.operation = NEXT;
    this.argument = undefined;
    this.n = location;
    return CONTINUE;
  }

  begin(method: ResumeMethod, argument: unknown): void {
    this.assertCheckpointHealthy();
    if (this.phase === "running") throw new TypeError("Generator is already running");
    this.method = method;
    this.operation = method === "next" ? NEXT : method === "throw" ? THROW : RETURN;
    this.argument = argument;
    if (this.isDone && method === "throw") throw argument;
  }

  step(): MachineStep {
    if (this.isDone)
      return {
        kind: "yield",
        result: { done: true, value: this.operation === RETURN ? this.argument : undefined },
      };
    while (true) {
      if (!this.delegate) {
        if (this.operation === NEXT) this.v = this.argument;
        else if (this.operation < JUMP) {
          if (this.operation === RETURN) this.n = -1;
          this.a(this.operation, this.argument);
        } else {
          if (typeof this.argument !== "number") throw new Error("Invalid machine jump target");
          this.n = this.argument;
        }
      }
      this.phase = "running";
      if (this.delegate)
        return {
          kind: "delegate",
          iterator: this.delegate,
          method: this.operation === NEXT ? "next" : this.method,
          argument: this.argument,
        };
      try {
        this.isDone = this.n < 0;
        const value = this.isDone
          ? this.argument
          : Reflect.apply(this.execute, this.receiver, [this]);
        if (value !== CONTINUE) return { kind: "yield", result: { done: this.isDone, value } };
      } catch (error) {
        this.receiveError(error);
      } finally {
        this.phase = "suspended";
      }
    }
  }

  receiveError(error: unknown): void {
    this.delegate = undefined;
    this.operation = THROW;
    this.argument = error;
    this.phase = "suspended";
  }

  receiveResult(result: IteratorResult<unknown>): void {
    this.argument = result.value;
    if (this.operation < RETURN) this.operation = NEXT;
    this.delegate = undefined;
    this.phase = "suspended";
  }

  missingMethod(method: ResumeMethod): void {
    this.delegate = undefined;
    if (method !== "return") {
      this.argument = new TypeError(`The iterator does not provide a '${method}' method`);
      this.operation = THROW;
    }
    this.phase = "suspended";
  }

  replaceDelegate(iterator: ExecutionMachine): void {
    this.delegate = iterator;
  }
  retire(): void {
    this.delegate = undefined;
    this.isDone = true;
    this.phase = "suspended";
  }
  suspend(): void {
    this.phase = "suspended";
  }
}

const originalMethods = {
  next: ExecutionMachine.prototype.next,
  throw: ExecutionMachine.prototype.throw,
  return: ExecutionMachine.prototype.return,
};

const driveFrames = (
  root: ExecutionMachine,
  stack: ExecutionMachine[],
): IteratorResult<unknown> => {
  while (stack.length) {
    const current = stack[stack.length - 1];
    let step: MachineStep;
    try {
      step = current.step();
    } catch (error) {
      current.suspend();
      stack.pop();
      if (!stack.length) throw error;
      stack[stack.length - 1].receiveError(error);
      continue;
    }
    if (step.kind === "yield") {
      if (!step.result.done) {
        for (const frame of stack) frame.suspend();
        return step.result;
      }
      const result = current.normalizeResult
        ? { done: true, value: current.normalizeResult(step.result.value) }
        : step.result;
      stack.pop();
      if (!stack.length) return result;
      stack[stack.length - 1].receiveResult(result);
      continue;
    }
    if (step.iterator instanceof TailTransfer) {
      const transfer = step.iterator;
      if (activeMetrics) activeMetrics.tailTransfers++;
      let boundaryIndex = stack.length - 1;
      while (boundaryIndex >= 0 && stack[boundaryIndex].boundary !== transfer.boundary)
        boundaryIndex--;
      if (boundaryIndex === -1 || !(transfer.iterator instanceof ExecutionMachine))
        throw new Error("Unresolved tail continuation boundary");
      const replacement = transfer.iterator;
      replacement.normalizeResult = stack[boundaryIndex].normalizeResult;
      for (let index = boundaryIndex; index < stack.length; index++) stack[index].retire();
      stack.length = boundaryIndex;
      if (stack.length) stack[stack.length - 1].replaceDelegate(replacement);
      else root.forward = replacement;
      replacement.begin("next", undefined);
      stack.push(replacement);
      recordDepth(stack);
      continue;
    }
    try {
      const callback: unknown = Reflect.get(step.iterator, step.method);
      if (callback === undefined) {
        if (step.method === "throw") {
          const close: unknown = Reflect.get(step.iterator, "return");
          if (close !== undefined) {
            if (typeof close !== "function") throw new TypeError("Iterator return is not callable");
            const closed: unknown = Reflect.apply(close, step.iterator, []);
            if (!isObject(closed)) throw new TypeError("Iterator result is not an object");
          }
        }
        current.missingMethod(step.method);
      } else {
        if (typeof callback !== "function") throw new TypeError("Iterator method is not callable");
        if (
          step.iterator instanceof ExecutionMachine &&
          originalMethods[step.method] === callback
        ) {
          step.iterator.begin(step.method, step.argument);
          stack.push(step.iterator);
          recordDepth(stack);
        } else {
          const result: unknown = Reflect.apply(callback, step.iterator, [step.argument]);
          if (!isObject(result)) throw new TypeError("Iterator result is not an object");
          const done = Boolean(Reflect.get(result, "done"));
          const value: unknown = Reflect.get(result, "value");
          if (!done) {
            for (const frame of stack) frame.suspend();
            return { done: false, value };
          }
          current.receiveResult({ done: true, value });
        }
      }
    } catch (error) {
      current.receiveError(error);
    }
  }
  throw new Error("Execution machine lost its root");
};

const drive = (
  root: ExecutionMachine,
  method: ResumeMethod,
  argument: unknown,
): IteratorResult<unknown> => {
  if (isCheckpointing) throw new Error("Cannot resume during a control checkpoint");
  root.assertCheckpointHealthy();
  let entry = root;
  while (entry.forward) {
    entry = entry.forward;
    entry.assertCheckpointHealthy();
  }
  entry.begin(method, argument);
  const stack = [entry];
  const previous = activeStack;
  const previousParentCount = parentFrameCount;
  parentFrameCount += previous?.length ?? 0;
  activeStack = stack;
  recordDepth(stack);
  try {
    return driveFrames(root, stack);
  } finally {
    activeStack = previous;
    parentFrameCount = previousParentCount;
  }
};

export const executionMachine = () => ({
  m: <Callback>(callback: Callback): Callback => callback,
  w: (
    execute: (context: MachineContext) => unknown,
    _outer?: unknown,
    receiver?: unknown,
    locations?: ReadonlyArray<ReadonlyArray<number | undefined>>,
    locals?: Record<string, unknown>,
    captures?: () => CaptureManifest,
  ): ExecutionMachine => new ExecutionMachine(execute, receiver, locations ?? [], locals, captures),
});
