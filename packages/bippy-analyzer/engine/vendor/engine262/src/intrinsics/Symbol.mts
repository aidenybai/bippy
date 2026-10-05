import {
  Descriptor,
  SymbolValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  KeyForSymbol,
  Realm,
  surroundingAgent,
  Throw,
  ToString,
  type FunctionObject,
  type OrdinaryObject,
} from '#self';

export interface SymbolObject extends OrdinaryObject {
  readonly SymbolData: SymbolValue;
}
export function isSymbolObject(o: Value): o is SymbolObject {
  return 'SymbolData' in o;
}
/** https://tc39.es/ecma262/#sec-symbol-description */
function* SymbolConstructor(this: FunctionObject, [description = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  // 1. If NewTarget is not undefined, throw a TypeError exception.
  if (NewTarget !== Value.undefined) {
    return Throw.TypeError('Symbol is not a constructor');
  }
  // 2. If description is undefined, let descString be undefined.
  let descString: string | undefined;
  if (description === Value.undefined) {
    descString = undefined;
  } else { // 3. Else, let descString be ? ToString(description).
    descString = Q(yield* ToString(description));
  }
  // 4. Return a new unique Symbol value whose [[Description]] value is descString.
  return new SymbolValue(descString);
}

/** https://tc39.es/ecma262/#sec-symbol.for */
function* Symbol_for([key = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let stringKey be ? ToString(key).
  const stringKey = Q(yield* ToString(key));
  const agentRecord = surroundingAgent.AgentRecord;
  const globalSymbolRegistry = agentRecord.GlobalSymbolRegistry;
  for (const e of globalSymbolRegistry) {
    // a. If SameValue(e.[[Key]], stringKey) is true, return e.[[Symbol]].
    if (e.Key === stringKey) {
      return e.Symbol;
    }
  }
  // 3. Assert: GlobalSymbolRegistry does not currently contain an entry for stringKey.
  // 4. Let newSymbol be a new unique Symbol value whose [[Description]] value is stringKey.
  const newSymbol = new SymbolValue(stringKey);
  // 5. Append the Record { [[Key]]: stringKey, [[Symbol]]: newSymbol } to the GlobalSymbolRegistry List.
  globalSymbolRegistry.push({ Key: stringKey, Symbol: newSymbol });
  // 6. Return newSymbol.
  return newSymbol;
}

/** https://tc39.es/ecma262/#sec-symbol.keyfor */
function Symbol_keyFor([sym = Value.undefined]: Arguments) {
  // 1. If Type(sym) is not Symbol, throw a TypeError exception.
  if (!(sym instanceof SymbolValue)) {
    return Throw.TypeError('arguments[0] ($1) is not a symbol', sym);
  }
  // 2. Return KeyForSymbol(sym).
  return Value(KeyForSymbol(sym));
}

export function bootstrapSymbol(realmRec: Realm) {
  const symbolConstructor = bootstrapConstructor(realmRec, SymbolConstructor, 'Symbol', 0, realmRec.Intrinsics['%Symbol.prototype%'], [
    ['for', Symbol_for, 1],
    ['keyFor', Symbol_keyFor, 1],
  ]);

  for (const [name, sym] of Object.entries(wellKnownSymbols)) {
    X(symbolConstructor.DefineOwnProperty(Value(name), Descriptor({
      Value: sym,
      Writable: false,
      Enumerable: false,
      Configurable: false,
    })));
  }

  X(symbolConstructor.DefineOwnProperty(Value('prototype'), Descriptor({
    Value: realmRec.Intrinsics['%Symbol.prototype%'],
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));

  realmRec.Intrinsics['%Symbol%'] = symbolConstructor;
}
