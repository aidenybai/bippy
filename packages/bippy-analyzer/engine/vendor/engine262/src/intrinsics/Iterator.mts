import {
  AbruptCompletion,
  IfAbruptCloseIterators,
  NormalCompletion,
  Q,
  X,
  type ValueEvaluator,
} from '../completion.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import {
  JSStringValue,
  ObjectValue,
  type PropertyKeyValue,
  UndefinedValue,
  Value,
  type Arguments,
  type FunctionCallContext,
  wellKnownSymbols,
} from '../value.mts';
import { type IteratorZipMode, IteratorZip } from '../abstract-ops/iterator-operations.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  Call,
  CreateArrayFromList,
  CreateDataPropertyOrThrow,
  CreateIteratorFromClosure,
  Get,
  GetIterator,
  GetIteratorDirect,
  GetIteratorFlattenable,
  GetMethod,
  IteratorClose,
  IteratorStepValue,
  OrdinaryCreateFromConstructor,
  OrdinaryHasInstance,
  OrdinaryObjectCreate,
  Yield,
  type BuiltinFunctionObject,
  type FunctionObject,
  type IteratorRecord,
  type IteratorObject,
  type Realm,
  Throw,
  type YieldEvaluator,
  GetOptionsObject,
} from '#self';


/** https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator-constructor */
function* IteratorConstructor(
  this: BuiltinFunctionObject,
  _args: Arguments,
  { NewTarget }: FunctionCallContext,
): ValueEvaluator<ObjectValue> {
  // 1. If NewTarget is either undefined or the active function object, throw a TypeError exception.
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Iterator cannot be invoked without new');
  }
  if (NewTarget === surroundingAgent.activeFunctionObject) {
    return Throw.TypeError('Iterator is an abstract class');
  }

  // 2. Return ? OrdinaryCreateFromConstructor(NewTarget, "%Iterator.prototype%").
  return Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%Iterator.prototype%'));
}

/** https://tc39.es/ecma262/#sec-iterator.from */
function* Iterator_from([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let iteratorRecord be ? GetIteratorFlattenable(O, iterate-string-primitives).
  const iteratorRecord = Q(yield* GetIteratorFlattenable(O, 'iterate-string-primitives'));

  // 2. Let hasInstance be ? OrdinaryHasInstance(%Iterator%, iteratorRecord.[[Iterator]]).
  const hasInstance: boolean = Q(yield* OrdinaryHasInstance(surroundingAgent.intrinsic('%Iterator%'), iteratorRecord.Iterator));
  // 3. If hasInstance is true, then
  if (hasInstance) {
    // a. Return iteratorRecord.[[Iterator]].
    return iteratorRecord.Iterator;
  }

  // 4. Let wrapper be OrdinaryObjectCreate(%WrapForValidIteratorPrototype%, « [[Iterated]] »).
  const wrapper = OrdinaryObjectCreate(
    surroundingAgent.intrinsic('%WrapForValidIteratorPrototype%'),
    ['Iterated'],
  ) as Mutable<IteratorObject>;
  // 5. Set wrapper.[[Iterated]] to iteratorRecord.
  wrapper.Iterated = iteratorRecord;
  // 6. Return wrapper.
  return wrapper;
}

/** https://tc39.es/ecma262/#sec-iterator.concat */
function* Iterator_concat(items: Arguments): ValueEvaluator {
  const iterables: { OpenMethod: FunctionObject, Iterable: ObjectValue }[] = [];
  for (const item of items.values()) {
    if (!(item instanceof ObjectValue)) {
      return Throw.TypeError('$1 is not an object', item);
    }
    const method = Q(yield* GetMethod(item, wellKnownSymbols.iterator));
    if (method instanceof UndefinedValue) {
      return Throw.TypeError('$1 is not iterable', item);
    }
    iterables.push({ OpenMethod: method, Iterable: item });
  }
  const gen = CreateIteratorFromClosure(function* Iterator_concat(): YieldEvaluator {
    for (const iterable of iterables) {
      const iter = Q(yield* Call(iterable.OpenMethod, iterable.Iterable));
      if (!(iter instanceof ObjectValue)) {
        return Throw.TypeError('$1 is not iterable', iter);
      }
      const iteratorRecord = Q(yield* GetIteratorDirect(iter));
      let innerAlive = true;
      while (innerAlive) {
        const innerValue = Q(yield* IteratorStepValue(iteratorRecord));
        if (innerValue === 'done') {
          innerAlive = false;
        } else {
          const completion = yield* Yield(innerValue);
          if (completion instanceof AbruptCompletion) {
            return Q(yield* IteratorClose(iteratorRecord, completion));
          }
        }
      }
    }
    return Value.undefined;
  }, 'Iterator Helper', surroundingAgent.intrinsic('%IteratorHelperPrototype%'), ['UnderlyingIterators']);
  gen.UnderlyingIterators = [];
  return gen;
}

/** https://tc39.es/ecma262/#sec-iterator.zip */
function* Iterator_zip([iterables = Value.undefined, _options = Value.undefined]: Arguments): ValueEvaluator {
  if (!(iterables instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', iterables);
  }
  const options = Q(GetOptionsObject(_options));

  const modeOption = Q(yield* Get(options, 'mode'));
  let mode: IteratorZipMode;
  if (modeOption === Value.undefined) mode = 'shortest';
  else if (!(modeOption instanceof JSStringValue)) {
    return Throw.TypeError('Iterator.zip mode must be one of "shortest", "longest", or "strict"');
  } else {
    const modeString = modeOption.stringValue();
    if (modeString !== 'shortest' && modeString !== 'longest' && modeString !== 'strict') {
      return Throw.TypeError('Iterator.zip mode must be one of "shortest", "longest", or "strict"');
    }
    mode = modeString;
  }

  let paddingOption: Value = Value.undefined;
  if (mode === 'longest') {
    paddingOption = Q(yield* Get(options, 'padding'));
    if (paddingOption !== Value.undefined && !(paddingOption instanceof ObjectValue)) {
      return Throw.TypeError('options.padding $1 is not an object', paddingOption);
    }
  }
  __ts_cast__<UndefinedValue | ObjectValue>(paddingOption);

  const iters: IteratorRecord[] = [];
  const padding: Value[] = [];
  const inputIter = Q(yield* GetIterator(iterables, 'sync'));

  let next: 'not-started' | Value | 'done' = 'not-started';
  while (next !== 'done') {
    const _next = yield* IteratorStepValue(inputIter);
    IfAbruptCloseIterators(_next, iters);
    next = X(_next);
    if (next !== 'done') {
      const iter = yield* GetIteratorFlattenable(next, 'reject-primitives');
      const needsClosing = [inputIter, ...iters];
      IfAbruptCloseIterators(iter, needsClosing);
      iters.push(X(iter));
    }
  }

  const iterCount = iters.length;
  if (mode === 'longest') {
    if (paddingOption === Value.undefined) {
      for (let i = 0; i < iterCount; i += 1) {
        padding.push(Value.undefined);
      }
    } else {
      const _paddingIter = yield* GetIterator(paddingOption, 'sync');
      IfAbruptCloseIterators(_paddingIter, iters);
      const paddingIter = X(_paddingIter);

      let usingIterator = true;
      for (let i = 0; i < iterCount; i += 1) {
        if (usingIterator === true) {
          const _next = yield* IteratorStepValue(paddingIter);
          IfAbruptCloseIterators(_next, iters);
          next = X(_next);
          if (next === 'done') {
            usingIterator = false;
          } else {
            padding.push(next);
          }
        }
        if (usingIterator === false) padding.push(Value.undefined);
      }

      if (usingIterator === true) {
        const completion = yield* IteratorClose(paddingIter, NormalCompletion(undefined));
        IfAbruptCloseIterators(completion, iters);
      }
    }
  }

  const finishResults = (results: readonly Value[]) => CreateArrayFromList(results);
  return IteratorZip(iters, mode, padding, finishResults);
}

/** https://tc39.es/ecma262/#sec-iterator.zipkeyed */
function* Iterator_zipKeyed([iterables = Value.undefined, _options = Value.undefined]: Arguments): ValueEvaluator {
  if (!(iterables instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', iterables);
  }
  const options = Q(GetOptionsObject(_options));

  const modeOption = Q(yield* Get(options, 'mode'));
  let mode: IteratorZipMode;
  if (modeOption === Value.undefined) mode = 'shortest';
  else if (!(modeOption instanceof JSStringValue)) {
    return Throw.TypeError('Iterator.zipKeyed mode must be one of "shortest", "longest", or "strict"');
  } else {
    const modeString = modeOption.stringValue();
    if (modeString !== 'shortest' && modeString !== 'longest' && modeString !== 'strict') {
      return Throw.TypeError('Iterator.zipKeyed mode must be one of "shortest", "longest", or "strict"');
    }
    mode = modeString;
  }

  let paddingOption: Value = Value.undefined;
  if (mode === 'longest') {
    paddingOption = Q(yield* Get(options, 'padding'));
    if (paddingOption !== Value.undefined && !(paddingOption instanceof ObjectValue)) {
      return Throw.TypeError('option.padding $1 is not an object', paddingOption);
    }
  }

  const iters: IteratorRecord[] = [];
  const padding: Value[] = [];
  const allKeys: PropertyKeyValue[] = Q(yield* iterables.OwnPropertyKeys());
  const keys: PropertyKeyValue[] = [];

  for (const key of allKeys) {
    const _propertyDesc = yield* iterables.GetOwnProperty(key);
    IfAbruptCloseIterators(_propertyDesc, iters);
    const propertyDesc = X(_propertyDesc);
    if (propertyDesc && propertyDesc.Enumerable) {
      const _value = yield* Get(iterables, key);
      IfAbruptCloseIterators(_value, iters);
      const value = X(_value);
      if (value !== Value.undefined) {
        keys.push(key);
        const _iter = yield* GetIteratorFlattenable(value, 'reject-primitives');
        IfAbruptCloseIterators(_iter, iters);
        const iter = X(_iter);
        iters.push(iter);
      }
    }
  }

  const iterCount = iters.length;
  if (mode === 'longest') {
    if (paddingOption === Value.undefined) {
      for (let i = 0; i < iterCount; i += 1) {
        padding.push(Value.undefined);
      }
    } else {
      __ts_cast__<ObjectValue>(paddingOption);
      for (const key of keys) {
        const _value = yield* Get(paddingOption, key);
        IfAbruptCloseIterators(_value, iters);
        const value = X(_value);
        padding.push(value);
      }
    }
  }

  const finishResults = (results: readonly Value[]) => {
    const obj = OrdinaryObjectCreate(Value.null);
    for (let i = 0; i < iterCount; i += 1) {
      X(CreateDataPropertyOrThrow(obj, keys[i], results[i]));
    }
    return obj;
  };
  return IteratorZip(iters, mode, padding, finishResults);
}

export function bootstrapIterator(realmRec: Realm) {
  const cons = bootstrapConstructor(realmRec, IteratorConstructor, 'Iterator', 0, realmRec.Intrinsics['%Iterator.prototype%'], [
    ['from', Iterator_from, 1],
    ['concat', Iterator_concat, 0],
    ['zip', Iterator_zip, 1],
    ['zipKeyed', Iterator_zipKeyed, 1],
  ]);

  realmRec.Intrinsics['%Iterator%'] = cons;
}
