import {
  Value, JSStringValue, ObjectValue, type Arguments,
  type FunctionCallContext,
  NullValue,
} from '../value.mts';
import { Q, type ValueEvaluator } from '../completion.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  Assert,
  OrdinaryObjectCreate,
  CreateIteratorResultObject,
  type OrdinaryObject,
  Realm,
} from '#self';

export interface ForInIteratorInstance extends OrdinaryObject {
  Object: ObjectValue | NullValue;
  ObjectWasVisited: Value;
  readonly VisitedKeys: string[];
  readonly RemainingKeys: string[];
}
/** https://tc39.es/ecma262/#sec-createforiniterator */
export function CreateForInIterator(object: ObjectValue) {
  // 1. Assert: Type(object) is Object.
  Assert(object instanceof ObjectValue);
  // 2. Let iterator be ObjectCreate(%ForInIteratorPrototype%, « [[Object]], [[ObjectWasVisited]], [[VisitedKeys]], [[RemainingKeys]] »).
  const iterator = OrdinaryObjectCreate(surroundingAgent.intrinsic('%ForInIteratorPrototype%'), [
    'Object',
    'ObjectWasVisited',
    'VisitedKeys',
    'RemainingKeys',
  ]) as Mutable<ForInIteratorInstance>;
  // 3. Set iterator.[[Object]] to object.
  iterator.Object = object;
  // 4. Set iterator.[[ObjectWasVisited]] to false.
  iterator.ObjectWasVisited = Value.false;
  // 5. Set iterator.[[VisitedKeys]] to a new empty List.
  iterator.VisitedKeys = [];
  // 6. Set iterator.[[RemainingKeys]] to a new empty List.
  iterator.RemainingKeys = [];
  // 7. Return iterator.
  return iterator;
}

/** https://tc39.es/ecma262/#sec-%foriniteratorprototype%.next */
function* ForInIteratorPrototype_next(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be this value.
  const O = thisValue;
  // 2. Assert: Type(O) is Object.
  Assert(O instanceof ObjectValue);
  // 3. Assert: O has all the internal slot sof a For-In Iterator Instance.
  Assert('Object' in O && 'ObjectWasVisited' in O && 'VisitedKeys' in O && 'RemainingKeys' in O);
  __ts_cast__<ForInIteratorInstance>(O);
  // 4. Let object be O.[[Object]].
  let object: ObjectValue | NullValue = O.Object;
  // 5. Let visited be O.[[VisitedKeys]].
  const visited = O.VisitedKeys;
  // 6. Let remaining be O.[[RemainingKeys]].
  const remaining = O.RemainingKeys;
  // 7. Repeat,
  while (true) {
    __ts_cast__<ObjectValue>(object);
    // a. If O.[[ObjectWasVisited]] is false, then
    if (O.ObjectWasVisited === Value.false) {
      // i. Let keys be ? object.[[OwnPropertyKeys]]().
      const keys = Q(yield* object.OwnPropertyKeys());
      // ii. for each key of keys in List order, do
      for (const key of keys) {
        // 1. If Type(key) is String, then
        if (key instanceof JSStringValue) {
          // a. Append key to remaining.
          remaining.push(key.stringValue());
        }
      }
      // iii. Set O.ObjectWasVisited to true.
      O.ObjectWasVisited = Value.true;
    }
    // b. Repeat, while remaining is not empty,
    while (remaining.length > 0) {
      // i. Remove the first element from remaining and let r be the value of the element.
      const r = remaining.shift()!;
      // ii. If there does not exist an element v of visisted such that SameValue(r, v) is true, then
      if (!visited.includes(r)) {
        // 1. Let desc be ? object.[[GetOwnProperty]](r).
        const desc = Q(yield* object.GetOwnProperty(Value(r)));
        // 2. If desc is not undefined, then,
        if (desc) {
          // a. Append r to visited.
          visited.push(r);
          // b. If desc.[[Enumerable]] is true, return CreateIteratorResultObject(r, false).
          if (desc.Enumerable) {
            return CreateIteratorResultObject(Value(r), false);
          }
        }
      }
    }
    // c. Set object to ? object.[[GetPrototypeOf]]().
    object = Q(yield* object.GetPrototypeOf());
    // d. Set O.Object to object.
    O.Object = object;
    // e. Set O.ObjectWasVisited to false.
    O.ObjectWasVisited = Value.false;
    // f. If object is null, return CreateIteratorResultObject(undefined, true).
    if (object === Value.null) {
      return CreateIteratorResultObject(Value.undefined, true);
    }
  }
}

export function bootstrapForInIteratorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['next', ForInIteratorPrototype_next, 0],
  ], realmRec.Intrinsics['%Iterator.prototype%']);

  realmRec.Intrinsics['%ForInIteratorPrototype%'] = proto;
}
