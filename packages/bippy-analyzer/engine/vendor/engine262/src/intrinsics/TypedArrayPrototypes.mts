import { bootstrapPrototype } from './bootstrap.mts';
import { typedArrayInfoByName, type TypedArrayConstructorNames } from './TypedArray.mts';
import { F, Realm } from '#self';

/** https://tc39.es/ecma262/#sec-properties-of-typedarray-prototype-objects */
export function bootstrapTypedArrayPrototypes(realmRec: Realm) {
  Object.entries(typedArrayInfoByName).forEach(([TypedArray, info]) => {
    const proto = bootstrapPrototype(realmRec, [
      ['BYTES_PER_ELEMENT', F(info.ElementSize), undefined, {
        Writable: false,
        Configurable: false,
      }],
    ], realmRec.Intrinsics['%TypedArray.prototype%']);
    realmRec.Intrinsics[`%${TypedArray as TypedArrayConstructorNames}.prototype%`] = proto;
  });
}
