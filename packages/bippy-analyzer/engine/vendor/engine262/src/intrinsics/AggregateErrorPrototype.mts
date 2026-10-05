import { Value } from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { Realm } from '#self';

export function bootstrapAggregateErrorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['name', Value('AggregateError')],
    ['message', Value('')],
  ], realmRec.Intrinsics['%Error.prototype%'], 'AggregateError');

  realmRec.Intrinsics['%AggregateError.prototype%'] = proto;
}
