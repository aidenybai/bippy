import {
  ObjectValue, UndefinedValue, Value, wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  AllocateTypedArray, InitializeTypedArrayFromArrayBuffer, InitializeTypedArrayFromArrayLike, InitializeTypedArrayFromList, InitializeTypedArrayFromTypedArray, isTypedArrayObject, typedArrayInfoByName, type TypedArrayConstructorNames,
} from './TypedArray.mts';
import {
  Assert,
  GetMethod,
  IteratorToList,
  ToIndex,
  F,
  Realm,
  GetIteratorFromMethod,
  isArrayBufferObject,
  Throw,
} from '#self';

export function bootstrapTypedArrayConstructors(realmRec: Realm) {
  Object.entries(typedArrayInfoByName).forEach(([TypedArray, info]) => {
    /** https://tc39.es/ecma262/#sec-typedarray-constructors */
    function* TypedArrayConstructor(this: Value, args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
      __ts_cast__<TypedArrayConstructorNames>(TypedArray);
      if (NewTarget instanceof UndefinedValue) {
        return Throw.TypeError('$1 cannot be invoked without new', TypedArray);
      }
      const constructorName = TypedArray;
      const proto = `%${TypedArray}.prototype%` as const;
      const numberOfArgs = args.length;
      if (numberOfArgs === 0) {
        return yield* AllocateTypedArray(constructorName, NewTarget, proto, 0);
      } else {
        const firstArgument = args[0]!;
        if (firstArgument instanceof ObjectValue) {
          const O = Q(yield* AllocateTypedArray(constructorName, NewTarget, proto));
          if (isTypedArrayObject(firstArgument)) {
            Q(yield* InitializeTypedArrayFromTypedArray(O, firstArgument));
          } else if (isArrayBufferObject(firstArgument)) {
            let byteOffset;
            let length;
            if (numberOfArgs > 1) {
              byteOffset = args[1]!;
            } else {
              byteOffset = Value.undefined;
            }
            if (numberOfArgs > 2) {
              length = args[2]!;
            } else {
              length = Value.undefined;
            }
            Q(yield* InitializeTypedArrayFromArrayBuffer(O, firstArgument, byteOffset, length));
          } else {
            Assert(firstArgument instanceof ObjectValue && !isTypedArrayObject(firstArgument) && !isArrayBufferObject(firstArgument));
            const usingIterator = Q(yield* GetMethod(firstArgument, wellKnownSymbols.iterator));
            if (!(usingIterator instanceof UndefinedValue)) {
              const values = Q(yield* IteratorToList(Q(yield* GetIteratorFromMethod(firstArgument, usingIterator))));
              Q(yield* InitializeTypedArrayFromList(O, values));
            } else {
              Q(yield* InitializeTypedArrayFromArrayLike(O, firstArgument));
            }
          }
          return O;
        } else {
          Assert(!(firstArgument instanceof ObjectValue));
          const elementLength = Q(yield* ToIndex(firstArgument));
          return yield* AllocateTypedArray(constructorName, NewTarget, proto, elementLength);
        }
      }
    }

    const taConstructor = bootstrapConstructor(realmRec, TypedArrayConstructor, TypedArray, 3, realmRec.Intrinsics[`%${TypedArray as TypedArrayConstructorNames}.prototype%`], [
      ['BYTES_PER_ELEMENT', F(info.ElementSize), undefined, {
        Writable: false,
        Configurable: false,
      }],
    ]);
    X(taConstructor.SetPrototypeOf(realmRec.Intrinsics['%TypedArray%']));
    realmRec.Intrinsics[`%${TypedArray as TypedArrayConstructorNames}%`] = taConstructor;
  });
}
