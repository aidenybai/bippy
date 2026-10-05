import {
  UndefinedValue, Value, wellKnownSymbols, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { IfAbruptCloseIterator, Q } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  Call,
  Get,
  GetIterator,
  IsCallable,
  IteratorStepValue,
  OrdinaryCreateFromConstructor,
  Realm,
  Throw,
  type FunctionObject,
  type OrdinaryObject,
} from '#self';

export interface SetObject extends OrdinaryObject {
  readonly SetData: (Value | undefined)[];
}
export function isSetObject(value: Value): value is SetObject {
  return 'SetData' in value;
}
/** https://tc39.es/ecma262/#sec-set-iterable */
function* SetConstructor(this: FunctionObject, [iterable = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext) {
  // 1. If NewTarget is undefined, throw a TypeError exception.
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Set cannot be invoked without new');
  }
  // 2. Let set be ? OrdinaryCreateFromConstructor(NewTarget, "%Set.prototype%", « [[SetData]] »).
  const set = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%Set.prototype%', ['SetData'])) as Mutable<SetObject>;
  // 3. Set set.[[SetData]] to a new empty List.
  set.SetData = [];
  // 4. If iterable is either undefined or null, return set.
  if (iterable === Value.undefined || iterable === Value.null) {
    return set;
  }
  // 5. Let adder be ? Get(set, "add").
  const adder = Q(yield* Get(set, 'add'));
  // 6. If IsCallable(adder) is false, throw a TypeError exception.
  if (!IsCallable(adder)) {
    return Throw.TypeError('this.add ($1) is not a function', adder);
  }
  // 7. Let iteratorRecord be ? GetIterator(iterable).
  const iteratorRecord = Q(yield* GetIterator(iterable, 'sync'));
  // 8. Repeat,
  while (true) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    // b. If next is false, return set.
    if (next === 'done') {
      return set;
    }
    // d. Let status be Call(adder, set, « next »).
    const status = yield* Call(adder, set, [next]);
    // e. IfAbruptCloseIterator(status, iteratorRecord).
    IfAbruptCloseIterator(status, iteratorRecord);
  }
}

/** https://tc39.es/ecma262/#sec-get-set-@@species */
function Set_speciesGetter(_args: Arguments, { thisValue }: FunctionCallContext) {
  // Return the this value.
  return thisValue;
}

export function bootstrapSet(realmRec: Realm) {
  const setConstructor = bootstrapConstructor(realmRec, SetConstructor, 'Set', 0, realmRec.Intrinsics['%Set.prototype%'], [
    [wellKnownSymbols.species, [Set_speciesGetter]],
  ]);

  realmRec.Intrinsics['%Set%'] = setConstructor;
}
