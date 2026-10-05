import { Value } from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { Realm } from '#self';

export function bootstrapSuppressedErrorPrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['name', Value('SuppressedError')],
    ['message', Value('')],
  ], realmRec.Intrinsics['%Error.prototype%'], 'SuppressedError');
  realmRec.Intrinsics['%SuppressedError.prototype%'] = prototype;
}
