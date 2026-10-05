import {
  Descriptor,
  JSStringValue,
  NullValue,
  ObjectValue,
  SymbolValue,
  UndefinedValue,
  Value,
  wellKnownSymbols,
  type NativeSteps,
} from '../value.mts';
import { X } from '../completion.mts';
import {
  Assert,
  CreateBuiltinFunction,
  markBuiltinFunctionAsConstructor,
  OrdinaryObjectCreate,
  Realm,
  type AccessorDescriptorInit,
  type DataDescriptorInit,
  type FunctionObject,
} from '#self';

type Accessor = [
  getter: NativeSteps | UndefinedValue | FunctionObject,
  setter?: NativeSteps | UndefinedValue | FunctionObject,
];

type Props = [
  name: string | JSStringValue | SymbolValue,
  value: Accessor | NativeSteps | Value,
  fnLength?: number,
  desc?: DataDescriptorInit | AccessorDescriptorInit,
  async?: boolean
];
/** https://tc39.es/ecma262/#sec-ecmascript-standard-built-in-objects */
export function assignProps(realmRec: Realm, obj: ObjectValue, props: readonly (Props | undefined)[]) {
  for (const item of props) {
    if (item === undefined) {
      continue;
    }
    const [n, v, len, descriptor, async] = item;
    const name = n instanceof Value ? n : Value(n);
    if (Array.isArray(v)) {
      // Every accessor property described in clauses 18 through 26 and in
      // Annex B.2 has the attributes { [[Enumerable]]: false,
      // [[Configurable]]: true } unless otherwise specified. If only a get
      // accessor function is described, the set accessor function is the
      // default value, undefined. If only a set accessor is described the get
      // accessor is the default value, undefined.
      let [
        getter = Value.undefined,
        setter = Value.undefined,
      ] = v;
      if (typeof getter === 'function') {
        getter = CreateBuiltinFunction(
          getter,
          0,
          name,
          [],
          realmRec,
          undefined,
          'get',
          async,
        );
      }
      if (typeof setter === 'function') {
        setter = CreateBuiltinFunction(
          setter,
          1,
          name,
          [],
          realmRec,
          undefined,
          'set',
          async,
        );
      }
      X(obj.DefineOwnProperty(name, Descriptor({
        Get: getter,
        Set: setter,
        Enumerable: false,
        Configurable: true,
        ...descriptor,
      })));
    } else {
      // Every other data property described in clauses 18 through 26 and in
      // Annex B.2 has the attributes { [[Writable]]: true, [[Enumerable]]:
      // false, [[Configurable]]: true } unless otherwise specified.
      let value;
      if (typeof v === 'function') {
        Assert(typeof len === 'number');
        value = CreateBuiltinFunction(v, len, name, [], realmRec, undefined, undefined, async);
      } else {
        value = v;
      }
      obj.properties.set(name, Descriptor({
        Value: value,
        Writable: true,
        Enumerable: false,
        Configurable: true,
        ...descriptor,
      }));
    }
  }
}

export function bootstrapPrototype(realmRec: Realm, props: readonly (Props | undefined)[], Prototype: ObjectValue | NullValue, stringTag?: string) {
  Assert(Prototype !== undefined);
  const proto = OrdinaryObjectCreate(Prototype);

  assignProps(realmRec, proto, props);

  if (stringTag !== undefined) {
    X(proto.DefineOwnProperty(wellKnownSymbols.toStringTag, Descriptor({
      Value: Value(stringTag),
      Writable: false,
      Enumerable: false,
      Configurable: true,
    })));
  }

  return proto;
}

export function bootstrapConstructor(realmRec: Realm, Constructor: NativeSteps, name: string, length: number, Prototype: ObjectValue, props: readonly (Props | undefined)[] = []) {
  const cons = CreateBuiltinFunction(
    markBuiltinFunctionAsConstructor(Constructor),
    length,
    Value(name),
    [],
    realmRec,
  );

  X(cons.DefineOwnProperty('prototype', Descriptor({
    Value: Prototype,
    Writable: false,
    Enumerable: false,
    Configurable: false,
  })));

  if (!Prototype.properties.has('constructor')) {
    X(Prototype.DefineOwnProperty('constructor', Descriptor({
      Value: cons,
      Writable: true,
      Enumerable: false,
      Configurable: true,
    })));
  }

  assignProps(realmRec, cons, props);

  return cons;
}
