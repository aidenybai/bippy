import {
  ObjectValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { bootstrapConstructor, bootstrapPrototype } from './bootstrap.mts';
import {
  Assert,
  HostGetModuleSourceModuleRecord,
  Realm,
  Throw,
} from '#self';

export type ModuleSourceObject = ObjectValue;

/** https://tc39.es/proposal-source-phase-imports/#sec-abstractmodulesource */
function AbstractModuleSourceConstructor(_args: Arguments, _context: FunctionCallContext) {
  // 1. Throw a TypeError exception.
  return Throw.TypeError('AbstractModuleSource cannot be constructed');
}

/** https://tc39.es/proposal-source-phase-imports/#sec-get-%abstractmodulesource%.prototype-%symbol.tostringtag% */
function AbstractModuleSourceProto_toStringTagGetter(_args: Arguments, { thisValue }: FunctionCallContext) {
  const O = thisValue;
  if (!(O instanceof ObjectValue)) {
    return Value.undefined;
  }
  const module = HostGetModuleSourceModuleRecord(O);
  if (module === 'not-a-source') {
    return Value.undefined;
  }
  const name = module.GetModuleSourceKind();
  Assert(typeof name === 'string');
  return Value(name);
}

export function bootstrapAbstractModuleSource(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    [wellKnownSymbols.toStringTag, [AbstractModuleSourceProto_toStringTagGetter, Value.undefined]],
  ], realmRec.Intrinsics['%Object.prototype%']);
  const constructor = bootstrapConstructor(realmRec, AbstractModuleSourceConstructor, 'AbstractModuleSource', 0, proto);
  constructor.Prototype = realmRec.Intrinsics['%Function.prototype%'];
  realmRec.Intrinsics['%AbstractModuleSource.prototype%'] = proto;
  realmRec.Intrinsics['%AbstractModuleSource%'] = constructor;
}
