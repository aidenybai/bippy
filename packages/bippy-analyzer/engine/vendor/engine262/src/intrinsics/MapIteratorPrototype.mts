import { Q, X } from '../completion.mts';
import { Value, type Arguments } from '../value.mts';
import type { YieldEvaluator } from '../evaluator.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  surroundingAgent,
  Assert,
  CreateArrayFromList,
  CreateIteratorFromClosure,
  GeneratorResume,
  Realm,
  RequireInternalSlot,
  Yield,
} from '#self';
import type {
  ValueEvaluator, FunctionCallContext, GeneratorObject, MapObject,
  ValueCompletion,
} from '#self';

/** https://tc39.es/ecma262/#sec-createmapiterator */
export function CreateMapIterator(map: Value, kind: 'key+value' | 'key' | 'value'): ValueCompletion<GeneratorObject> {
  Assert(kind === 'key+value' || kind === 'key' || kind === 'value');
  // 1. Perform ? RequireInternalSlot(map, [[MapData]]).
  Q(RequireInternalSlot(map, 'MapData'));
  // 2. Let closure be a new Abstract Closure with no parameters that captures map and kind and performs the following steps when called:
  const closure = function* closure(): YieldEvaluator {
    // a. Let entries be the List that is map.[[MapData]].
    const entries = (map as MapObject).MapData;
    // b. Let index be 0.
    let index = 0;
    // c. Let numEntries be the number of elements of entries.
    let numEntries = entries.length;
    // d. Repeat, while index < numEntries,
    while (index < numEntries) {
      // i. Let e be the Record { [[Key]], [[Value]] } that is the value of entries[index].
      const e = entries[index];
      // ii. Set index to index + 1.
      index += 1;
      // iii. If e.[[Key]] is not empty, then
      if (e.Key !== undefined) {
        let result;
        // 1. If kind is key, let result be e.[[Key]].
        if (kind === 'key') {
          result = e.Key;
        } else if (kind === 'value') { // 2. Else if kind is value, let result be e.[[Value]].
          result = e.Value;
        } else { // 3. Else,
          // a. Assert: kind is key+value.
          Assert(kind === 'key+value');
          // b. Let result be ! CreateArrayFromList(« e.[[Key]], e.[[Value]] »).
          result = X(CreateArrayFromList([e.Key, e.Value!]));
        }
        // 4. Perform ? Yield(result).
        Q(yield* Yield(result!));
      }
      // iv. Set numEntries to the number of elements of entries.
      numEntries = entries.length;
    }
    // NON-SPEC
    generator.HostCapturedValues = undefined;
    // e. Return undefined.
    return Value.undefined;
  };
  // 3. Return ! CreateIteratorFromClosure(closure, "%MapIteratorPrototype%", %MapIteratorPrototype%).
  const generator = X(CreateIteratorFromClosure(closure, '%MapIteratorPrototype%', surroundingAgent.intrinsic('%MapIteratorPrototype%'), ['HostCapturedValues'], [map]));
  return generator;
}

/** https://tc39.es/ecma262/#sec-%mapiteratorprototype%.next */
function* MapIteratorPrototype_next(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Return ? GeneratorResume(this value, empty, "%MapIteratorPrototype%")
  return Q(yield* GeneratorResume(thisValue, undefined, '%MapIteratorPrototype%'));
}

export function bootstrapMapIteratorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['next', MapIteratorPrototype_next, 0],
  ], realmRec.Intrinsics['%Iterator.prototype%'], 'Map Iterator');

  realmRec.Intrinsics['%MapIteratorPrototype%'] = proto;
}
