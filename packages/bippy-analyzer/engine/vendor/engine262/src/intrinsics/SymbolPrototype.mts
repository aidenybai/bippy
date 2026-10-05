import {
  ObjectValue,
  SymbolValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, type ValueCompletion } from '../completion.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  Assert,
  Realm,
  SymbolDescriptiveString,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-thissymbolvalue */
export function ThisSymbolValue(value: Value) {
  // 1. If Type(value) is Symbol, return value.
  if (value instanceof SymbolValue) {
    return value;
  }
  // 2. If Type(value) is Object and value has a [[SymbolData]] internal slot, then
  if (value instanceof ObjectValue && 'SymbolData' in value) {
    // a. Let s be value.[[SymbolData]].
    const s = value.SymbolData;
    // b. Assert: Type(s) is Symbol.
    Assert(s instanceof SymbolValue);
    // c. Return s.
    return s;
  }
  // 3. Throw a TypeError exception.
  return Throw.TypeError('$1 is not a $2 object', value, 'Symbol');
}

/** https://tc39.es/ecma262/#sec-symbol.prototype.description */
function SymbolProto_descriptionGetter(_argList: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let s be the this value.
  const s = thisValue;
  // 2. Let sym be ? thisSymbolValue(s).
  const sym = Q(ThisSymbolValue(s));
  // 3. Return sym.[[Description]].
  return Value(sym.Description);
}

/** https://tc39.es/ecma262/#sec-symbol.prototype.tostring */
function SymbolProto_toString(_argList: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let sym be ? thisSymbolValue(this value).
  const sym = Q(ThisSymbolValue(thisValue));
  // 2. Return SymbolDescriptiveString(sym).
  return Value(SymbolDescriptiveString(sym));
}

/** https://tc39.es/ecma262/#sec-symbol.prototype.valueof */
function SymbolProto_valueOf(_argList: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Return ? thisSymbolValue(this value).
  return Q(ThisSymbolValue(thisValue));
}

/** https://tc39.es/ecma262/#sec-symbol.prototype-@@toprimitive */
function SymbolProto_toPrimitive(_argList: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Return ? thisSymbolValue(this value).
  return Q(ThisSymbolValue(thisValue));
}

export function bootstrapSymbolPrototype(realmRec: Realm) {
  const override = {
    Writable: false,
    Enumerable: false,
    Configurable: true,
  };
  const proto = bootstrapPrototype(realmRec, [
    ['toString', SymbolProto_toString, 0],
    ['description', [SymbolProto_descriptionGetter]],
    ['valueOf', SymbolProto_valueOf, 0],
    [wellKnownSymbols.toPrimitive, SymbolProto_toPrimitive, 1, override],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Symbol');

  realmRec.Intrinsics['%Symbol.prototype%'] = proto;
}
