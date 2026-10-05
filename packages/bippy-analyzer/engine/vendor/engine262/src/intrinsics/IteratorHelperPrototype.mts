import {
  NormalCompletion, Q, ReturnCompletion, type ValueEvaluator,
} from '../completion.mts';
import {
  Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  Assert,
  CreateIteratorResultObject,
  GeneratorResume,
  GeneratorResumeAbrupt,
  IteratorCloseAll,
  Realm,
  RequireInternalSlot,
  type GeneratorObject,
} from '#self';

/** https://tc39.es/ecma262/#sec-%iteratorhelperprototype%.next */
function* IteratorHelperPrototype_next(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Return ? GeneratorResume(this value, undefined, "Iterator Helper").
  return Q(yield* GeneratorResume(thisValue, Value.undefined, 'Iterator Helper'));
}

/** https://tc39.es/ecma262/#sec-%iteratorhelperprototype%.return */
function* IteratorHelperPrototype_return(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be this value.
  const O = thisValue;
  // 2. Perform ? RequireInternalSlot(O, [[UnderlyingIterators]]).
  Q(RequireInternalSlot(O, 'UnderlyingIterators'));
  // 3. Assert: O has a [[GeneratorState]] internal slot.
  Assert('GeneratorState' in O);

  // 4. If O.[[GeneratorState]] is suspended-start, then
  if (O.GeneratorState === 'suspendedStart') {
    // a. Set O.[[GeneratorState]] to completed.
    O.GeneratorState = 'completed';

    // b. NOTE: Once a generator enters the completed state it never leaves it and its associated execution context is never resumed.
    // Any execution state associated with O can be discarded at this point.
    // c. Perform ? IteratorCloseAll(O.[[UnderlyingIterators]], NormalCompletion(unused)).
    Q(yield* IteratorCloseAll((O as GeneratorObject).UnderlyingIterators!, NormalCompletion(undefined)));

    // d. Return CreateIteratorResultObject(undefined, true).
    return CreateIteratorResultObject(Value.undefined, true);
  }

  // 5. Let C be ReturnCompletion(undefined).
  const completion = ReturnCompletion(Value.undefined);
  // 6. Return ? GeneratorResumeAbrupt(O, C, "Iterator Helper").
  return Q(yield* GeneratorResumeAbrupt(O, completion, 'Iterator Helper'));
}

export function bootstrapIteratorHelperPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['next', IteratorHelperPrototype_next, 0],
    ['return', IteratorHelperPrototype_return, 0],
  ], realmRec.Intrinsics['%Iterator.prototype%'], 'Iterator Helper');

  realmRec.Intrinsics['%IteratorHelperPrototype%'] = proto;
}
