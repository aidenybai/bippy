import {
  AbruptCompletion,
  EnsureCompletion,
  IfAbruptCloseIterator,
  NormalCompletion,
  Q,
  ReturnCompletion,
  X,
  type PlainCompletion,
  type ValueCompletion,
  type ValueEvaluator,
} from '../completion.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import {
  JSStringValue,
  NumberValue,
  ObjectValue,
  UndefinedValue,
  Value, wellKnownSymbols, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  Call,
  CreateArrayFromList,
  CreateIteratorFromClosure,
  GetIteratorDirect,
  GetIteratorFlattenable,
  GetMethod,
  IsCallable,
  IteratorClose,
  IteratorStep,
  IteratorStepValue,
  SameValueZero,
  SetterThatIgnoresPrototypeProperties,
  ToBoolean,
  ToIntegerOrInfinity,
  ToNumber,
  ToString,
  Throw,
  Yield,
  type GeneratorObject,
  type IteratorRecord,
  type Realm,
} from '#self';

/** https://tc39.es/ecma262/#sec-iterator.prototype-%symbol.dispose% */
function* IteratorProto_dispose(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  const returnMethod = Q(yield* GetMethod(obj, 'return'));
  if (!(returnMethod instanceof UndefinedValue)) {
    Q(yield* Call(returnMethod, obj));
  }
  return Value.undefined;
}

/** https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-get-iterator.prototype.constructor */
function IteratorProto_constructor_getter() {
  return surroundingAgent.intrinsic('%Iterator%');
}

/** https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-set-iterator.prototype.constructor */
function* IteratorProto_constructor_setter([v = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator<UndefinedValue> {
  Q(yield* SetterThatIgnoresPrototypeProperties(
    thisValue,
    surroundingAgent.intrinsic('%Iterator.prototype%'),
    Value('constructor'),
    v,
  ));
  return Value.undefined;
}

/** https://tc39.es/proposal-iterator-chunking/#sec-iterator.prototype.chunks */
function* IteratorProto_chunks([chunkSize = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (!(chunkSize instanceof NumberValue) || !chunkSize.isIntegralNumber()) {
    const error = Throw.TypeError('$1 is not an integral Number', chunkSize);
    return Q(yield* IteratorClose(iterated, error));
  }
  if (chunkSize.value < 1 || chunkSize.value > (2 ** 32) - 1) {
    const error = Throw.RangeError('$1 is out of range', chunkSize);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  const closure = function* closure(): ValueEvaluator {
    let buffer: Value[] = [];
    while (true) {
      const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
      if (value === 'done') {
        if (buffer.length !== 0) {
          EnsureCompletion(yield* Yield(CreateArrayFromList(buffer)));
        }
        return ReturnCompletion(Value.undefined);
      }
      buffer.push(value);
      // If the number of elements in buffer is ℝ(chunkSize), then
      if (buffer.length === chunkSize.value) {
        const completion = EnsureCompletion(yield* Yield(CreateArrayFromList(buffer)));
        IfAbruptCloseIterator(completion, iterated);
        buffer = [];
      }
    }
  };
  const result = CreateIteratorFromClosure(
    closure,
    'Iterator Helper',
    surroundingAgent.currentRealmRecord.Intrinsics['%IteratorHelperPrototype%'],
    ['UnderlyingIterators'],
  );
  result.UnderlyingIterators = [iterated];
  return result;
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.drop */
function* IteratorProto_drop([limit = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  const numberLimit: ValueCompletion<NumberValue> = EnsureCompletion(yield* ToNumber(limit));
  IfAbruptCloseIterator(numberLimit, iterated);
  __ts_cast__<NumberValue>(numberLimit);
  if (numberLimit.isNaN()) {
    const error = Throw.RangeError('$1 is out of range', numberLimit);
    return Q(yield* IteratorClose(iterated, error));
  }
  if (numberLimit.isFinite() && numberLimit.value > (2 ** 53) - 1) {
    const error = Throw.RangeError('$1 is out of range', numberLimit);
    return Q(yield* IteratorClose(iterated, error));
  }
  const intLimit: number = X(yield* ToIntegerOrInfinity(numberLimit instanceof NormalCompletion ? numberLimit.Value : numberLimit));
  if (intLimit < 0) {
    const error = Throw.RangeError('$1 is out of range', numberLimit);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  const closure = function* closure(): ValueEvaluator {
    let remaining: number = intLimit;
    while (remaining > 0) {
      remaining -= 1;
      const next = Q(yield* IteratorStep(iterated));
      if (next === 'done') {
        return ReturnCompletion(Value.undefined);
      }
    }
    while (true) {
      const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
      if (value === 'done') {
        return ReturnCompletion(Value.undefined);
      }
      const completion = EnsureCompletion(yield* Yield(value));
      IfAbruptCloseIterator(completion, iterated);
    }
  };
  const result: Mutable<GeneratorObject> = CreateIteratorFromClosure(
    closure,
    'Iterator Helper',
    surroundingAgent.currentRealmRecord.Intrinsics['%IteratorHelperPrototype%'],
    ['UnderlyingIterators'],
  );
  result.UnderlyingIterators = [iterated];
  return result;
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.every */
function* IteratorProto_every([predicate = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (IsCallable(predicate) === false) {
    const error = Throw.TypeError('$1 is not a function', predicate);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  let counter = 0;
  while (true) {
    const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
    if (value === 'done') {
      return Value.true;
    }
    const result: ValueCompletion = yield* Call(predicate, Value.undefined, [value, Value(counter)]);
    IfAbruptCloseIterator(result, iterated);
    __ts_cast__<Value>(result);
    if (!ToBoolean(result)) {
      return Q(yield* IteratorClose(iterated, EnsureCompletion(Value.false)));
    }
    // NOTE: The following step will not change counter once it reaches 2 ** 53.
    counter += 1;
  }
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.filter */
function* IteratorProto_filter([predicate = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (IsCallable(predicate) === false) {
    const error = Throw.TypeError('$1 is not a function', predicate);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  const closure = function* closure(): ValueEvaluator {
    let counter = 0;
    while (true) {
      const value = Q(yield* IteratorStepValue(iterated));
      if (value === 'done') {
        return ReturnCompletion(Value.undefined);
      }
      const selected: ValueCompletion = yield* Call(predicate, Value.undefined, [value, Value(counter)]);
      IfAbruptCloseIterator(selected, iterated);
      __ts_cast__<Value>(selected);
      if (ToBoolean(selected)) {
        const completion = EnsureCompletion(yield* Yield(value));
        IfAbruptCloseIterator(completion, iterated);
      }
      // NOTE: The following step will not change counter once it reaches 2 ** 53.
      counter += 1;
    }
  };
  const result = CreateIteratorFromClosure(
    closure,
    'Iterator Helper',
    surroundingAgent.currentRealmRecord.Intrinsics['%IteratorHelperPrototype%'],
    ['UnderlyingIterators'],
  );
  result.UnderlyingIterators = [iterated];
  return result;
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.find */
function* IteratorProto_find([predicate = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (IsCallable(predicate) === false) {
    const error = Throw.TypeError('$1 is not a function', predicate);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  let counter = 0;
  while (true) {
    const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
    if (value === 'done') {
      return Value.undefined;
    }
    const result: ValueCompletion = yield* Call(predicate, Value.undefined, [value, Value(counter)]);
    IfAbruptCloseIterator(result, iterated);
    __ts_cast__<Value>(result);
    if (ToBoolean(result)) {
      return Q(yield* IteratorClose(iterated, EnsureCompletion(value)));
    }
    // NOTE: The following step will not change counter once it reaches 2 ** 53.
    counter += 1;
  }
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.flatmap */
function* IteratorProto_flatMap([mapper = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (IsCallable(mapper) === false) {
    const error = Throw.TypeError('$1 is not a function', mapper);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  const closure = function* closure(): ValueEvaluator {
    let counter = 0;
    while (true) {
      const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
      if (value === 'done') {
        return ReturnCompletion(Value.undefined);
      }
      const mapped: ValueCompletion = EnsureCompletion(yield* Call(mapper, Value.undefined, [value, Value(counter)]));
      IfAbruptCloseIterator(mapped, iterated);
      __ts_cast__<Value>(mapped);
      const innerIterator: PlainCompletion<IteratorRecord> = EnsureCompletion(yield* GetIteratorFlattenable(mapped, 'reject-primitives'));
      IfAbruptCloseIterator(innerIterator, iterated);
      __ts_cast__<IteratorRecord>(innerIterator);
      let innerAlive = true;
      while (innerAlive) {
        const innerValue: PlainCompletion<Value | 'done'> = yield* IteratorStepValue(innerIterator);
        IfAbruptCloseIterator(innerValue, iterated);
        __ts_cast__<Value | 'done'>(innerValue);
        if (innerValue === 'done') {
          innerAlive = false;
        } else {
          const completion = EnsureCompletion(yield* Yield(innerValue));
          if (completion instanceof AbruptCompletion) {
            const backupCompletion = EnsureCompletion(yield* IteratorClose(innerIterator, completion));
            IfAbruptCloseIterator(backupCompletion, iterated);
            return Q(yield* IteratorClose(iterated, completion));
          }
        }
      }
      // NOTE: The following step will not change counter once it reaches 2 ** 53.
      counter += 1;
    }
  };

  const result = CreateIteratorFromClosure(
    closure,
    'Iterator Helper',
    surroundingAgent.currentRealmRecord.Intrinsics['%IteratorHelperPrototype%'],
    ['UnderlyingIterators'],
  );
  result.UnderlyingIterators = [iterated];
  return result;
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.foreach */
function* IteratorProto_forEach([procedure = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (IsCallable(procedure) === false) {
    const error = Throw.TypeError('$1 is not a function', procedure);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  let counter = 0;
  while (true) {
    const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
    if (value === 'done') {
      return Value.undefined;
    }
    const result: ValueCompletion = yield* Call(procedure, Value.undefined, [value, Value(counter)]);
    IfAbruptCloseIterator(result, iterated);
    // NOTE: The following step will not change counter once it reaches 2 ** 53.
    counter += 1;
  }
}

/** https://tc39.es/proposal-iterator-includes/#sec-iterator.prototype.includes */
function* IteratorProto_includes([searchElement = Value.undefined, skippedElements = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  let toSkip: NumberValue;
  if (skippedElements === Value.undefined) {
    toSkip = Value(0);
  } else {
    if (!(skippedElements instanceof NumberValue)
        || (!skippedElements.isInfinity() && !skippedElements.isIntegralNumber())) {
      const error = Throw.TypeError('$1 is not an integral Number or infinity', skippedElements);
      return Q(yield* IteratorClose(iterated, error));
    }
    toSkip = skippedElements;
  }
  if (toSkip.value < -0) {
    const error = Throw.RangeError('$1 is out of range', toSkip);
    return Q(yield* IteratorClose(iterated, error));
  }
  if (toSkip.isFinite() && toSkip.value > (2 ** 53) - 1) {
    const error = Throw.RangeError('$1 is out of range', toSkip);
    return Q(yield* IteratorClose(iterated, error));
  }
  let skipped = 0;
  iterated = Q(yield* GetIteratorDirect(obj));
  while (true) {
    const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
    if (value === 'done') {
      return Value.false;
    }
    if (skipped < toSkip.value) {
      skipped += 1;
    } else if (SameValueZero(value, searchElement)) {
      return Q(yield* IteratorClose(iterated, NormalCompletion(Value.true)));
    }
  }
}

/** https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.prototype-%symbol.iterator% */
function IteratorProto_iterator(_args: Arguments, { thisValue }: FunctionCallContext) {
  return thisValue;
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.map */
function* IteratorProto_map([mapper = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (IsCallable(mapper) === false) {
    const error = Throw.TypeError('$1 is not a function', mapper);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  const closure = function* closure(): ValueEvaluator {
    let counter = 0;
    while (true) {
      const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
      if (value === 'done') {
        return ReturnCompletion(Value.undefined);
      }
      const mapped: ValueCompletion = yield* Call(mapper, Value.undefined, [value, Value(counter)]);
      IfAbruptCloseIterator(mapped, iterated);
      __ts_cast__<Value>(mapped);
      const completion = EnsureCompletion(yield* Yield(mapped));
      IfAbruptCloseIterator(completion, iterated);
      // NOTE: The following step will not change counter once it reaches 2 ** 53.
      counter += 1;
    }
  };
  const result = CreateIteratorFromClosure(
    closure,
    'Iterator Helper',
    surroundingAgent.currentRealmRecord.Intrinsics['%IteratorHelperPrototype%'],
    ['UnderlyingIterators'],
  );
  result.UnderlyingIterators = [iterated];
  return result;
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.reduce */
function* IteratorProto_reduce(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  const reducer = args[0] ?? Value.undefined;
  if (IsCallable(reducer) === false) {
    const error = Throw.TypeError('$1 is not a function', reducer);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  let accumulator: Value | 'done';
  let counter: number;
  if (args.length < 2) {
    accumulator = Q(yield* IteratorStepValue(iterated));
    if (accumulator === 'done') {
      return Throw.TypeError('The iterator is already complete.');
    }
    counter = 1;
  } else {
    accumulator = args[1] ?? Value.undefined;
    counter = 0;
  }
  while (true) {
    const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
    if (value === 'done') {
      return accumulator;
    }
    const result: ValueCompletion = yield* Call(reducer, Value.undefined, [accumulator, value, Value(counter)]);
    IfAbruptCloseIterator(result, iterated);
    __ts_cast__<Value>(result);
    accumulator = result;
    // NOTE: The following step will not change counter once it reaches 2 ** 53.
    counter += 1;
  }
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.some */
function* IteratorProto_some([predicate = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (IsCallable(predicate) === false) {
    const error = Throw.TypeError('$1 is not a function', predicate);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  let counter = 0;
  while (true) {
    const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
    if (value === 'done') {
      return Value.false;
    }
    const result: ValueCompletion = yield* Call(predicate, Value.undefined, [value, Value(counter)]);
    IfAbruptCloseIterator(result, iterated);
    __ts_cast__<Value>(result);
    if (ToBoolean(result)) {
      return Q(yield* IteratorClose(iterated, EnsureCompletion(Value.true)));
    }
    // NOTE: The following step will not change counter once it reaches 2 ** 53.
    counter += 1;
  }
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.take */
function* IteratorProto_take([limit = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  const numberLimit: ValueCompletion<NumberValue> = yield* ToNumber(limit);
  IfAbruptCloseIterator(numberLimit, iterated);
  __ts_cast__<Value>(numberLimit);
  if (numberLimit.isNaN()) {
    const error = Throw.RangeError('$1 is out of range', numberLimit);
    return Q(yield* IteratorClose(iterated, error));
  }
  if (numberLimit.isFinite() && numberLimit.value > (2 ** 53) - 1) {
    const error = Throw.RangeError('$1 is out of range', numberLimit);
    return Q(yield* IteratorClose(iterated, error));
  }
  const intLimit: number = X(yield* ToIntegerOrInfinity(numberLimit instanceof NormalCompletion ? numberLimit.Value : numberLimit));
  if (intLimit < 0) {
    const error = Throw.RangeError('$1 is out of range', numberLimit);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  const closure = function* closure(): ValueEvaluator {
    let remaining: number = intLimit;
    while (true) {
      if (remaining === 0) {
        return Q(yield* IteratorClose(iterated, ReturnCompletion(Value.undefined)));
      }
      remaining -= 1;
      const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
      if (value === 'done') {
        return ReturnCompletion(Value.undefined);
      }
      const completion = EnsureCompletion(yield* Yield(value));
      IfAbruptCloseIterator(completion, iterated);
    }
  };
  const result: Mutable<GeneratorObject> = CreateIteratorFromClosure(
    closure,
    'Iterator Helper',
    surroundingAgent.currentRealmRecord.Intrinsics['%IteratorHelperPrototype%'],
    ['UnderlyingIterators'],
  );
  result.UnderlyingIterators = [iterated];
  return result;
}

/** https://tc39.es/proposal-iterator-chunking/#sec-iterator.prototype.windows */
function* IteratorProto_windows([windowSize = Value.undefined, undersized = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  if (!(windowSize instanceof NumberValue) || !windowSize.isIntegralNumber()) {
    const error = Throw.TypeError('$1 is not an integral Number', windowSize);
    return Q(yield* IteratorClose(iterated, error));
  }
  if (windowSize.value < 1 || windowSize.value > (2 ** 32) - 1) {
    const error = Throw.RangeError('$1 is out of range', windowSize);
    return Q(yield* IteratorClose(iterated, error));
  }
  if (undersized === Value.undefined) {
    undersized = Value('only-full');
  }
  if (!(undersized instanceof JSStringValue)
      || (undersized.stringValue() !== 'only-full' && undersized.stringValue() !== 'allow-partial')) {
    const error = Throw.TypeError('$1 is not a valid undersized mode', undersized);
    return Q(yield* IteratorClose(iterated, error));
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  const closure = function* closure(): ValueEvaluator {
    const buffer: Value[] = [];
    while (true) {
      const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
      if (value === 'done') {
        if (undersized.stringValue() === 'allow-partial'
            && buffer.length !== 0
            && buffer.length < windowSize.value) {
          EnsureCompletion(yield* Yield(X(CreateArrayFromList(buffer))));
        }
        return ReturnCompletion(Value.undefined);
      }
      if (buffer.length === windowSize.value) {
        buffer.shift();
      }
      buffer.push(value);
      if (buffer.length === windowSize.value) {
        const completion = EnsureCompletion(yield* Yield(X(CreateArrayFromList(buffer))));
        IfAbruptCloseIterator(completion, iterated);
      }
    }
  };
  const result = CreateIteratorFromClosure(
    closure,
    'Iterator Helper',
    surroundingAgent.currentRealmRecord.Intrinsics['%IteratorHelperPrototype%'],
    ['UnderlyingIterators'],
  );
  result.UnderlyingIterators = [iterated];
  return result;
}

/** https://tc39.es/ecma262/#sec-iterator.prototype.toarray */
function* IteratorProto_toArray(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  const iterated: IteratorRecord = Q(yield* GetIteratorDirect(obj));
  const items: Value[] = [];
  while (true) {
    const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
    if (value === 'done') {
      return CreateArrayFromList(items);
    }
    items.push(value);
  }
}

/** https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-get-iterator.prototype-%symbol.tostringtag% */
function IteratorProto_toStringTagGetter() {
  return Value('Iterator');
}

/** https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-set-iterator.prototype-%symbol.tostringtag% */
function* IteratorPrototype_toStringTag_setter([v = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator<UndefinedValue> {
  Q(yield* SetterThatIgnoresPrototypeProperties(
    thisValue,
    surroundingAgent.intrinsic('%Iterator.prototype%'),
    wellKnownSymbols.toStringTag,
    v,
  ));
  return Value.undefined;
}

/** https://tc39.es/proposal-iterator-join/#sec-iterator.prototype.join */
function* IteratorProto_join([separator = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = thisValue;
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  let iterated: IteratorRecord = { Iterator: obj, NextMethod: Value.undefined, Done: false };
  let sep: string;
  if (separator === Value.undefined) {
    sep = ',';
  } else {
    const sepCompletion = yield* ToString(separator);
    IfAbruptCloseIterator(sepCompletion, iterated);
    sep = X(sepCompletion);
  }
  iterated = Q(yield* GetIteratorDirect(obj));
  let result = '';
  let first = true;
  while (true) {
    const value: Value | 'done' = Q(yield* IteratorStepValue(iterated));
    if (value === 'done') {
      return Value(result);
    }
    if (first) {
      first = false;
    } else {
      result += sep;
    }
    if (value !== Value.undefined && value !== Value.null) {
      const valueString = yield* ToString(value);
      IfAbruptCloseIterator(valueString, iterated);
      result += X(valueString);
    }
  }
}

export function bootstrapIteratorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['constructor', [IteratorProto_constructor_getter, IteratorProto_constructor_setter]],
    ['chunks', IteratorProto_chunks, 1],
    ['drop', IteratorProto_drop, 1],
    [wellKnownSymbols.dispose, IteratorProto_dispose, 0],
    ['every', IteratorProto_every, 1],
    ['filter', IteratorProto_filter, 1],
    ['find', IteratorProto_find, 1],
    ['flatMap', IteratorProto_flatMap, 1],
    ['forEach', IteratorProto_forEach, 1],
    ['includes', IteratorProto_includes, 1],
    ['join', IteratorProto_join, 1],
    ['map', IteratorProto_map, 1],
    ['reduce', IteratorProto_reduce, 1],
    ['some', IteratorProto_some, 1],
    ['take', IteratorProto_take, 1],
    ['toArray', IteratorProto_toArray, 0],
    ['windows', IteratorProto_windows, 1],
    [wellKnownSymbols.iterator, IteratorProto_iterator, 0],
    [wellKnownSymbols.toStringTag, [IteratorProto_toStringTagGetter, IteratorPrototype_toStringTag_setter]],
  ], realmRec.Intrinsics['%Object.prototype%']);

  realmRec.Intrinsics['%Iterator.prototype%'] = proto;
}
