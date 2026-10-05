import { Q, type ValueEvaluator } from '../completion.mts';
import {
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  GeneratorResume,
  Realm,
} from '#self';

/** https://tc39.es/ecma262/#sec-%stringiteratorprototype%.next */
function* StringIteratorPrototype_next(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Return ? GeneratorResume(this value, empty, "%StringIteratorPrototype%").
  return Q(yield* GeneratorResume(thisValue, undefined, '%StringIteratorPrototype%'));
}

export function bootstrapStringIteratorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['next', StringIteratorPrototype_next, 0],
  ], realmRec.Intrinsics['%Iterator.prototype%'], 'String Iterator');

  realmRec.Intrinsics['%StringIteratorPrototype%'] = proto;
}
