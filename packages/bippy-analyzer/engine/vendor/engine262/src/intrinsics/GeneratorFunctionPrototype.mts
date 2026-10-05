import { Descriptor } from '../value.mts';
import { X } from '../completion.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { DefinePropertyOrThrow } from '#self';
import type { Realm } from '#self';

export function bootstrapGeneratorFunctionPrototype(realmRec: Realm) {
  const generatorPrototype = realmRec.Intrinsics['%GeneratorFunction.prototype.prototype%'];

  const generator = bootstrapPrototype(realmRec, [
    ['prototype', generatorPrototype, undefined, { Writable: false }],
  ], realmRec.Intrinsics['%Function.prototype%'], 'GeneratorFunction');

  X(DefinePropertyOrThrow(generatorPrototype, 'constructor', Descriptor({
    Value: generator,
    Writable: false,
    Enumerable: false,
    Configurable: true,
  })));

  realmRec.Intrinsics['%GeneratorFunction.prototype%'] = generator;
}
