import {
  Value, type Arguments,
} from './value.mts';
import { kAsyncContext } from './utils/internal.mts';
import { callable, OutOfRange } from './utils/language.mts';
import type { Evaluator } from './evaluator.mts';
import {
  type GCMarker,
  Assert,
  CreateBuiltinFunction,
  PerformPromiseThen,
  PromiseCapabilityRecord,
  PromiseResolve,
  RunSuspendedContext,
  type IteratorRecord,
  runningExecutionContext,
  intrinsics,
  RunCallerContext,
  type ValueEvaluator,
} from '#self';
import { skipDebugger } from '#self';

let createNormalCompletion: <T>(init: NormalCompletionInit<T>) => NormalCompletionImpl<T>;
let createBreakCompletion: (init: BreakCompletionInit) => BreakCompletion;
let createContinueCompletion: (init: ContinueCompletionInit) => ContinueCompletion;
let createReturnCompletion: (init: ReturnCompletionInit) => ReturnCompletion;
let createThrowCompletion: (init: ThrowCompletionInit) => ThrowCompletion_;

export type NormalCompletionInit<T> = Pick<NormalCompletion<T>, 'Type' | 'Value' | 'Target'>;

export type BreakCompletionInit = Pick<BreakCompletion, 'Type' | 'Value' | 'Target'>;

export type ContinueCompletionInit = Pick<ContinueCompletion, 'Type' | 'Value' | 'Target'>;

export type ReturnCompletionInit = Pick<ReturnCompletion, 'Type' | 'Value' | 'Target'>;

export type ThrowCompletionInit = Pick<ThrowCompletion, 'Type' | 'Value' | 'Target'>;

export type AbruptCompletionInit =
  | BreakCompletionInit
  | ContinueCompletionInit
  | ReturnCompletionInit
  | ThrowCompletionInit;

export type CompletionInit<T> =
  | NormalCompletionInit<T>
  | AbruptCompletionInit;

@callable((_target, _thisArg, [completionRecord]) => {
  // 1. Assert: completionRecord is a Completion Record.
  Assert(completionRecord instanceof Completion);
  // 2. Return completionRecord as the Completion Record of this abstract operation.
  return completionRecord;
})
export class CompletionImpl<const T> {
  declare readonly Type: 'normal' | 'break' | 'continue' | 'return' | 'throw';

  readonly Value!: T | Value;

  readonly Target!: string | undefined;

  constructor(init: CompletionInit<T>) {
    if (new.target === CompletionImpl) {
      switch (init.Type) {
        case 'normal':
          return createNormalCompletion(init);
        case 'break':
          return createBreakCompletion(init) as CompletionImpl<T>;
        case 'continue':
          return createContinueCompletion(init) as CompletionImpl<T>;
        case 'return':
          return createReturnCompletion(init) as CompletionImpl<T>;
        case 'throw':
          return createThrowCompletion(init) as CompletionImpl<T>;
        default:
          throw OutOfRange.exhaustive(init);
      }
    }

    const { Type, Value, Target } = init;
    Assert(new.target.prototype.Type === Type);
    this.Value = Value as T;
    this.Target = Target;
  }

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.Value);
  }

  static {
    Object.defineProperty(this, 'name', { value: 'Completion' });
  }
}

/** https://tc39.es/ecma262/#sec-completion-record-specification-type */
export type Completion<T> =
  | NormalCompletion<T>
  | AbruptCompletion;

/**
 * A NON-SPEC shorthand to notate "returns either a normal completion containing an ECMAScript language value or a throw completion".
 */
// export type ValueEvaluator<T extends Value = Value> = T | NormalCompletion<T> | ThrowCompletion;
export type ValueCompletion<T extends Value = Value> = T | NormalCompletion<T> | ThrowCompletion;
export { type ValueEvaluator } from './evaluator.mts';
/**
 * A NON-SPEC shorthand to notate "returns either a normal completion containing ... or a throw completion".
 *
 * If the T is an ECMAScript language value, use ExpressionCompletion<T>.
 */
export type PlainCompletion<T> = T | NormalCompletion<T> | ThrowCompletion;
export type YieldCompletion = Value | NormalCompletion<Value> | ThrowCompletion | ReturnCompletion;

/** https://tc39.es/ecma262/#sec-completion-ao */
export const Completion = CompletionImpl as {
  /** https://tc39.es/ecma262/#sec-completion-ao */
  <T extends Completion<unknown>>(completionRecord: T): T;

  /** https://tc39.es/ecma262/#sec-completion-record-specification-type */
  new <const T>(completion: { Type: 'normal', Value: T, Target: undefined }): NormalCompletion<T>;
  new(completion: { Type: 'break', Value: void, Target: string | undefined }): BreakCompletion;
  new(completion: { Type: 'continue', Value: void, Target: string | undefined }): ContinueCompletion;
  new(completion: { Type: 'return', Value: Value, Target: undefined }): ReturnCompletion;
  new(completion: { Type: 'throw', Value: Value, Target: undefined }): ThrowCompletion;
  readonly prototype: CompletionImpl<unknown>;
};

@callable((_target, _thisArg, [value]) => { // eslint-disable-line arrow-body-style -- Preserve algorithm steps comments
  // 1. Return Completion { [[Type]]: normal, [[Value]]: value, [[Target]]: empty }.
  return new Completion({ Type: 'normal', Value: value, Target: undefined });
})
export class NormalCompletionImpl<const T> extends CompletionImpl<T> {
  declare readonly Type: 'normal';

  declare readonly Value: T;

  declare readonly Target: undefined;

  private constructor(init: NormalCompletionInit<T>) { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super(init);
  }

  static {
    Object.defineProperty(this, 'name', { value: 'NormalCompletion' });
    Object.defineProperty(this.prototype, 'Type', { value: 'normal' });
    createNormalCompletion = (init) => new NormalCompletionImpl(init);
  }
}

/** https://tc39.es/ecma262/#sec-completion-record-specification-type */
export type NormalCompletion<T> = NormalCompletionImpl<T>;

/** https://tc39.es/ecma262/#sec-normalcompletion */
export const NormalCompletion = NormalCompletionImpl as typeof NormalCompletionImpl & {
  /** https://tc39.es/ecma262/#sec-normalcompletion */
  <const T>(value: T): NormalCompletion<T>;
};

/** https://tc39.es/ecma262/#sec-completion-record-specification-type */
export type AbruptCompletion =
  | ThrowCompletion
  | ReturnCompletion
  | BreakCompletion
  | ContinueCompletion;

/** https://tc39.es/ecma262/#sec-completion-record-specification-type */
export const AbruptCompletion = (() => {
  abstract class AbruptCompletion<const T> extends CompletionImpl<T | Value> {
    declare readonly Type: 'break' | 'continue' | 'return' | 'throw';

    declare readonly Value: T | Value;

    declare readonly Target: string | undefined;

    constructor(init: AbruptCompletionInit) { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
      super(init);
    }

    static {
      Object.defineProperty(this, 'name', { value: 'AbruptCompletion' });
    }
  }

  return AbruptCompletion;
})();

/** https://tc39.es/ecma262/#sec-completion-record-specification-type */
export class BreakCompletion extends AbruptCompletion<void> {
  declare readonly Type: 'break';

  declare readonly Value: void;

  private constructor(init: BreakCompletionInit) { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super(init);
  }

  static {
    Object.defineProperty(this, 'name', { value: 'BreakCompletion' });
    Object.defineProperty(this.prototype, 'Type', { value: 'break' });
    createBreakCompletion = (init) => new BreakCompletion(init);
  }
}

/** https://tc39.es/ecma262/#sec-completion-record-specification-type */
export class ContinueCompletion extends AbruptCompletion<void> {
  declare readonly Type: 'continue';

  declare readonly Value: void;

  declare readonly Target: string | undefined;

  private constructor(init: ContinueCompletionInit) { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super(init);
  }

  static {
    Object.defineProperty(this, 'name', { value: 'ContinueCompletion' });
    Object.defineProperty(this.prototype, 'Type', { value: 'continue' });
    createContinueCompletion = (init) => new ContinueCompletion(init);
  }
}

@callable((_target, _thisArg, [value]) => {
  Assert(value instanceof Value);
  // 1. Return Completion { [[Type]]: return, [[Value]]: value, [[Target]]: empty }.
  return new Completion({ Type: 'return', Value: value as Value, Target: undefined });
})
export class ReturnCompletion_ extends AbruptCompletion<Value> {
  declare readonly Type: 'return';

  declare readonly Value: Value;

  declare readonly Target: undefined;

  private constructor(init: ReturnCompletionInit) { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super(init);
  }

  static {
    Object.defineProperty(this, 'name', { value: 'ReturnCompletion' });
    Object.defineProperty(this.prototype, 'Type', { value: 'return' });
    createReturnCompletion = (init) => new ReturnCompletion(init);
  }
}

/** https://tc39.es/ecma262/#sec-completion-record-specification-type */
export type ReturnCompletion = ReturnCompletion_;

/** https://tc39.es/ecma262/#sec-throwcompletion */
export const ReturnCompletion = ReturnCompletion_ as typeof ReturnCompletion_ & {
  /** https://tc39.es/ecma262/#sec-throwcompletion */
  <T extends Value = Value>(value: T): ThrowCompletion<T>;
};

const debugging = false;
@callable((_target, _thisArg, [value]) => {
  Assert(value instanceof Value);
  // 1. Return Completion { [[Type]]: throw, [[Value]]: value, [[Target]]: empty }.
  return new Completion({ Type: 'throw', Value: value as Value, Target: undefined });
})
export class ThrowCompletion_<T extends Value = Value> extends AbruptCompletion<T> {
  declare readonly Type: 'throw';

  declare readonly Value: T;

  declare readonly Target: undefined;

  readonly stack = debugging ? new Error() : undefined;

  private constructor(init: Pick<ThrowCompletion_<T>, 'Type' | 'Value' | 'Target'>) { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super(init);
    if (debugging) {
      if ('stackTraceLimit' in Error) {
        Error.stackTraceLimit = Infinity;
      }
    }
  }

  static {
    Object.defineProperty(this, 'name', { value: 'ThrowCompletion' });
    Object.defineProperty(this.prototype, 'Type', { value: 'throw' });
    createThrowCompletion = (init) => new ThrowCompletion_(init);
  }
}

/** https://tc39.es/ecma262/#sec-completion-record-specification-type */
export type ThrowCompletion<T extends Value = Value> = ThrowCompletion_<T>;

/** https://tc39.es/ecma262/#sec-throwcompletion */
export const ThrowCompletion = ThrowCompletion_ as typeof ThrowCompletion_ & {
  /** https://tc39.es/ecma262/#sec-throwcompletion */
  <T extends Value = Value>(value: T): ThrowCompletion<T>;
};

/** https://tc39.es/ecma262/#sec-updateempty */
export type UpdateEmpty<T extends Completion<unknown>, U> =
  T extends NormalCompletion<infer V> ? NormalCompletion<V extends undefined ? U : V> :
  T extends BreakCompletion ? BreakCompletion :
  T extends ContinueCompletion ? ContinueCompletion :
  T extends AbruptCompletion ? T :
  T extends ReturnCompletion ? T :
  never;

/** https://tc39.es/ecma262/#sec-updateempty */
export function UpdateEmpty<C extends Completion<unknown>, const T>(completionRecord: C, value: T): UpdateEmpty<C, T>;
export function UpdateEmpty<C extends Completion<unknown>, const T>(completionRecord: C, value: T) {
  // 1. Assert: If completionRecord.[[Type]] is either return or throw, then completionRecord.[[Value]] is not empty.
  Assert(!(completionRecord.Type === 'return' || completionRecord.Type === 'throw') || completionRecord.Value !== undefined);
  // 2. If completionRecord.[[Value]] is not empty, return Completion(completionRecord).
  if (completionRecord.Value !== undefined) {
    return Completion(completionRecord);
  }
  // 3. Return Completion { [[Type]]: completionRecord.[[Type]], [[Value]]: value, [[Target]]: completionRecord.[[Target]] }.
  return new CompletionImpl({ Type: completionRecord.Type, Value: value, Target: completionRecord.Target } as unknown as CompletionInit<unknown>); // NOTE: unsound cast
}

/** https://tc39.es/ecma262/#sec-returnifabrupt */
export type Q<T> =
  T extends NormalCompletion<infer V> ? V :
  T extends AbruptCompletion ? never :
  T;

/**
 * https://tc39.es/ecma262/#sec-returnifabrupt
 * https://tc39.es/ecma262/#sec-returnifabrupt-shorthands ? OperationName()
 *
 * @internal
 */
export function Q<const T>(_completion: T): Q<T> {
  /* node:coverage ignore next */
  throw new TypeError('Q requires build');
}

function Q_runtime<const T>(completion: T): Q<T> {
  /* node:coverage ignore next 3 */
  if (isEvaluator(completion)) {
    throw new TypeError('Forgot to yield* on the completion.');
  }
  const c = EnsureCompletion(completion);
  if (c.Type === 'normal') {
    return c.Value as Q<T>;
  }
  throw c;
}

export function isEvaluator(value: unknown): value is Evaluator<unknown> {
  return !!(value && typeof value === 'object' && 'next' in value && typeof value.next === 'function');
}

/**
 * https://tc39.es/ecma262/#sec-returnifabrupt-shorthands ! OperationName()
 */
export function X<const T>(completion: T | Evaluator<T>): Q<T> {
  /* node:coverage ignore next 3 */
  if (isEvaluator(completion)) {
    completion = skipDebugger(completion);
  }
  const c = EnsureCompletion(completion);
  if (c instanceof NormalCompletion) {
    return c.Value as Q<T>;
  }
  /* node:coverage ignore next */
  throw new Assert.Error('Unexpected AbruptCompletion.', { cause: c });
}

export { X as unwrapCompletion };

/**
 * https://tc39.es/ecma262/#sec-ifabruptcloseiterator
 * @internal
 */
export function IfAbruptCloseIterator<T>(_value: T, _iteratorRecord: IteratorRecord): Q<T> {
  /* node:coverage ignore next */
  throw new TypeError('IfAbruptCloseIterator() requires build');
}

/**
 * https://tc39.es/ecma262/#sec-ifabruptcloseiterators
 * @internal
 */
export function IfAbruptCloseIterators<T>(_value: T, _iteratorRecords: Iterable<IteratorRecord>): Q<T> {
  /* node:coverage ignore next */
  throw new TypeError('IfAbruptCloseIterators() requires build');
}

/**
 * https://tc39.es/ecma262/#sec-ifabruptcloseasynciterator
 * @internal
 */
export function IfAbruptCloseAsyncIterator<T>(_value: T, _iteratorRecord: IteratorRecord): Q<T> {
  /* node:coverage ignore next */
  throw new TypeError('IfAbruptCloseAsyncIterator() requires build');
}

/**
 * https://tc39.es/ecma262/#sec-ifabruptrejectpromise
 * @internal
 */
export function IfAbruptRejectPromise<T>(_value: T, _capability: PromiseCapabilityRecord): Q<T> {
  /* node:coverage ignore next */
  throw new TypeError('IfAbruptRejectPromise requires build');
}

/**
 * This is a util for code that cannot use Q() macro to emulate this behaviour.
 *
 * @example
 * import { evalQ } from '...'
 * evalQ((Q) => {
 *     let val = Q(operation);
 * });
 */
export function evalQ<T>(callback: (q: <const V>(completion: V) => Q<V>) => Promise<T>): Promise<NormalCompletion<T> | ThrowCompletion>
export function evalQ<T>(callback: (q: <const V>(completion: V) => Q<V>) => T): NormalCompletion<T> | ThrowCompletion
export function evalQ<T>(callback: (q: <const V>(completion: V) => Q<V>) => T | Promise<T>): Promise<NormalCompletion<T> | ThrowCompletion> | NormalCompletion<T> | ThrowCompletion {
  try {
    const result = callback(Q_runtime);
    if (result instanceof Promise) {
      return result.then(EnsureCompletion, (error) => {
        if (error instanceof ThrowCompletion) {
          return error;
        }
        throw error;
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return EnsureCompletion(result) as any;
  } catch (error) {
    if (error instanceof ThrowCompletion) {
      return error;
    }
    // a real error
    throw error;
  }
}

export type EnsureCompletion<T> = EnsureCompletionWorker<T, T>;

// Distribute over `T`s that are `Completion`s, but don't distribute over `T`s that aren't `Completion`s
export type EnsureCompletionWorker<T, _T> = T extends Completion<unknown> ? T : NormalCompletion<Exclude<_T, PlainCompletion<unknown>>>;

/** https://tc39.es/ecma262/#sec-implicit-normal-completion */
export function EnsureCompletion(val: Value): NormalCompletion<Value>;
export function EnsureCompletion<const T>(val: T): EnsureCompletion<T>;
export function EnsureCompletion<const T>(val: T) {
  if (val instanceof Completion) {
    return val;
  }
  return NormalCompletion(val);
}

export function ValueOfNormalCompletion<T>(value: NormalCompletion<T> | T) {
  return value instanceof NormalCompletion ? value.Value : value;
}

// TODO(spec): in which case Await might return NormalCompletion<empty>?
export function* Await(arg: Value): ValueEvaluator {
  const asyncContext = runningExecutionContext();
  const promise = Q(yield* PromiseResolve(intrinsics()['%Promise%'], arg));
  const fulfilledClosure = function* fulfilledClosure([v = Value.undefined]: Arguments) {
    yield* RunSuspendedContext(asyncContext, { resume: 'await', value: NormalCompletion(v) });
    return Value.undefined;
  };
  const onFulfilled = CreateBuiltinFunction(fulfilledClosure, 1, Value(''), []);
  // @ts-expect-error TODO(ts): CreateBuiltinFunction should return a specalized type FunctionObjectValue that has a kAsyncContext on it.
  onFulfilled[kAsyncContext] = asyncContext;
  const rejectedClosure = function* rejectedClosure([reason = Value.undefined]: Arguments) {
    yield* RunSuspendedContext(asyncContext, { resume: 'await', value: ThrowCompletion(reason) });
    return Value.undefined;
  };
  const onRejected = CreateBuiltinFunction(rejectedClosure, 1, Value(''), []);
  // @ts-expect-error TODO(ts): CreateBuiltinFunction should return a specalized type FunctionObjectValue that has a kAsyncContext on it.
  onRejected[kAsyncContext] = asyncContext;
  PerformPromiseThen(promise, onFulfilled, onRejected);
  return yield* RunCallerContext({ suspend: 'await' });
}
