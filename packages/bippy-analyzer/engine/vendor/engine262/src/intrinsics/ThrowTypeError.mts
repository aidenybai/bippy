import { Value } from '../value.mts';
import { X } from '../completion.mts';
import {
  Assert,
  CreateBuiltinFunction,
  Realm,
  SetIntegrityLevel,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-%throwtypeerror% */
function ThrowTypeError() {
  // 1. Throw a TypeError exception.
  return Throw.TypeError('The caller, callee, and arguments properties may not be accessed on functions or the arguments objects for calls to them');
}

export function bootstrapThrowTypeError(realmRec: Realm) {
  const f = X(CreateBuiltinFunction(ThrowTypeError, 0, Value(''), [], realmRec));
  Assert(X(SetIntegrityLevel(f, 'frozen')));
  realmRec.Intrinsics['%ThrowTypeError%'] = f;
}
