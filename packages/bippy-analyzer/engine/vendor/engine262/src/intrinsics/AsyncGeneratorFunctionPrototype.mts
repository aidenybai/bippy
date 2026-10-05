import { X } from '../completion.mts';
import { Descriptor, Value } from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { Realm } from '#self';

export function bootstrapAsyncGeneratorFunctionPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['prototype', realmRec.Intrinsics['%AsyncGeneratorFunction.prototype.prototype%'], undefined, { Writable: false }],
  ], realmRec.Intrinsics['%Function.prototype%'], 'AsyncGeneratorFunction');

  X((realmRec.Intrinsics['%AsyncGeneratorFunction.prototype.prototype%']).DefineOwnProperty(Value('constructor'), Descriptor({
    Value: proto,
    Writable: false,
    Enumerable: false,
    Configurable: true,
  })));

  realmRec.Intrinsics['%AsyncGeneratorFunction.prototype%'] = proto;
}
