import { __ts_cast__ } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  type IteratorObject,

  Assert,
  Call,
  CreateIteratorResultObject,
  GetMethod,
  ObjectValue,
  Q,
  RequireInternalSlot,
  UndefinedValue,
  Value,
  type Arguments,
  type FunctionCallContext,
  type IteratorRecord,
  type Realm,
  type ValueEvaluator,
} from '#self';

/** https://tc39.es/ecma262/#sec-%wrapforvaliditeratorprototype%.next */
function* WrapForValidIteratorPrototype_next(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be this value.
  const O = thisValue;
  // 2. Perform ? RequireInternalSlot(O, [[Iterated]]).
  Q(RequireInternalSlot(O, 'Iterated'));
  // 3. Let iteratorRecord be O.[[Iterated]].
  __ts_cast__<IteratorObject>(O);
  const iteratorRecord: IteratorRecord = O.Iterated;
  // 4. Return ? Call(iteratorRecord.[[NextMethod]], iteratorRecord.[[Iterator]]).
  return Q(yield* Call(iteratorRecord.NextMethod, iteratorRecord.Iterator));
}

/** https://tc39.es/ecma262/#sec-%wrapforvaliditeratorprototype%.return */
function* WrapForValidIteratorPrototype_return(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be this value.
  const O = thisValue;
  // 2. Perform ? RequireInternalSlot(O, [[Iterated]]).
  Q(RequireInternalSlot(O, 'Iterated'));
  // 3. Let iterator be O.[[Iterated]].[[Iterator]].
  __ts_cast__<IteratorObject>(O);
  const iteratorRecord: IteratorRecord = O.Iterated;
  const iterator = iteratorRecord.Iterator;
  // 4. Assert: iterator is an Object.
  Assert(iterator instanceof ObjectValue);
  // 5. Let returnMethod be ? GetMethod(iterator, "return").
  const returnMethod = Q(yield* GetMethod(iterator, 'return'));
  // 6. If returnMethod is undefined, then
  if (returnMethod instanceof UndefinedValue) {
    // a. Return CreateIteratorResultObject(undefined, true).
    return CreateIteratorResultObject(Value.undefined, true);
  }
  // 7. Return ? Call(returnMethod, iterator).
  return Q(yield* Call(returnMethod, iterator));
}

export function bootstrapWrapForValidIteratorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['next', WrapForValidIteratorPrototype_next, 0],
    ['return', WrapForValidIteratorPrototype_return, 0],
  ], realmRec.Intrinsics['%Iterator.prototype%']);

  realmRec.Intrinsics['%WrapForValidIteratorPrototype%'] = proto;
}
