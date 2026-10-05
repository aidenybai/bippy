import { Q, type ValueEvaluator } from '../completion.mts';
import {
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  GeneratorResume,
} from '#self';
import type { Realm } from '#self';

/** https://tc39.es/ecma262/#sec-%arrayiteratorprototype%.next */
function* ArrayIteratorPrototype_next(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Return ? GeneratorResume(this value, empty, "%ArrayIteratorPrototype%").
  return Q(yield* GeneratorResume(thisValue, undefined, '%ArrayIteratorPrototype%'));
}

export function bootstrapArrayIteratorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['next', ArrayIteratorPrototype_next, 0],
  ], realmRec.Intrinsics['%Iterator.prototype%'], 'Array Iterator');

  realmRec.Intrinsics['%ArrayIteratorPrototype%'] = proto;
}
