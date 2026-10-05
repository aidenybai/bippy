import {
  Q, X, BoundNames, surroundingAgent,
  type Mutable, type ParseNode,
  Assert,
  CreateBuiltinFunction,
  CreateDataProperty,
  DefinePropertyOrThrow,
  ToString,
  SameValue,
  MakeBasicObject,
  OrdinaryObjectCreate,
  OrdinaryGetOwnProperty,
  OrdinaryDefineOwnProperty,
  OrdinaryGet,
  OrdinarySet,
  OrdinaryDelete,
  Get,
  Set,
  HasOwnProperty,
  IsAccessorDescriptor,
  IsDataDescriptor,
  F,
  type OrdinaryObject,
  Descriptor,
  ObjectValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type ObjectInternalMethods,
  EnvironmentRecord,
  type ECMAScriptFunctionObject,
  type PlainEvaluator,
  type FullyPopulatedDescriptor,
  type DataDescriptorInit,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-arguments-exotic-objects */
export interface MappedArgumentsObject extends OrdinaryObject {
  readonly ParameterMap: ObjectValue;
}
export interface UnmappedArgumentsObject extends OrdinaryObject {
  readonly ParameterMap: undefined;
}

export function isArgumentExoticObject(value: Value): value is MappedArgumentsObject | UnmappedArgumentsObject {
  return 'ParameterMap' in value;
}

const ArgumentExoticObject = {
  * GetOwnProperty(P): PlainEvaluator<FullyPopulatedDescriptor | undefined> {
    const args = this;
    const desc = OrdinaryGetOwnProperty(args, P);
    if (desc === undefined) {
      return desc;
    }
    const map = args.ParameterMap;
    const isMapped = X(HasOwnProperty(map, P));
    if (isMapped) {
      return Descriptor({ ...desc, Value: Q(yield* Get(map, P)) } as Required<DataDescriptorInit>);
    }
    return desc;
  },
  * DefineOwnProperty(P, Desc): PlainEvaluator<boolean> {
    const args = this;
    const map = args.ParameterMap;
    const isMapped = X(HasOwnProperty(map, P));
    let newArgDesc = Desc;
    if (isMapped && IsDataDescriptor(Desc) === true) {
      if (Desc.Value === undefined && Desc.Writable !== undefined && !Desc.Writable) {
        newArgDesc = Descriptor({ ...Desc, Value: X(Get(map, P)) });
      }
    }
    const allowed = Q(yield* OrdinaryDefineOwnProperty(args, P, newArgDesc));
    if (!allowed) {
      return false;
    }
    if (isMapped) {
      if (IsAccessorDescriptor(Desc) === true) {
        yield* map.Delete(P);
      } else {
        if (Desc.Value !== undefined) {
          const setStatus = X(yield* Set(map, P, Desc.Value, false));
          Assert(setStatus);
        }
        if (Desc.Writable !== undefined && !Desc.Writable) {
          yield* map.Delete(P);
        }
      }
    }
    return true;
  },
  * Get(P, Receiver) {
    const args = this;
    const map = args.ParameterMap;
    const isMapped = X(HasOwnProperty(map, P));
    if (!isMapped) {
      return Q(yield* OrdinaryGet(args, P, Receiver));
    } else {
      return yield* Get(map, P);
    }
  },
  * Set(P, V, Receiver) {
    const args = this;
    let isMapped;
    let map;
    if (!SameValue(args, Receiver)) {
      isMapped = false;
    } else {
      map = args.ParameterMap;
      isMapped = X(HasOwnProperty(map, P));
    }
    if (isMapped) {
      const setStatus = X(yield* Set(map!, P, V, false));
      Assert(setStatus);
    }
    return Q(yield* OrdinarySet(args, P, V, Receiver));
  },
  * Delete(P) {
    const args = this;
    const map = args.ParameterMap;
    const isMapped = X(HasOwnProperty(map, P));
    const result = Q(yield* OrdinaryDelete(args, P));
    if (result && isMapped) {
      yield* map.Delete(P);
    }
    return result;
  },
} satisfies Partial<ObjectInternalMethods<MappedArgumentsObject>>;

/** https://tc39.es/ecma262/#sec-createunmappedargumentsobject */
export function CreateUnmappedArgumentsObject(argumentsList: Arguments) {
  const len = argumentsList.length;
  const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'), ['ParameterMap']) as Mutable<UnmappedArgumentsObject>;
  obj.ParameterMap = undefined;
  X(DefinePropertyOrThrow(obj, 'length', Descriptor({
    Value: F(len),
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));
  let index = 0;
  while (index < len) {
    const val = argumentsList[index];
    X(CreateDataProperty(obj, X(ToString(F(index))), val!));
    index += 1;
  }
  X(DefinePropertyOrThrow(obj, wellKnownSymbols.iterator, Descriptor({
    Value: surroundingAgent.intrinsic('%Array.prototype.values%'),
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));
  X(DefinePropertyOrThrow(obj, 'callee', Descriptor({
    Get: surroundingAgent.intrinsic('%ThrowTypeError%'),
    Set: surroundingAgent.intrinsic('%ThrowTypeError%'),
    Enumerable: false,
    Configurable: false,
  })));
  return obj;
}

/** https://tc39.es/ecma262/#sec-makearggetter */
function MakeArgGetter(name: string, env: EnvironmentRecord) {
  // 1. Let getterClosure be a new Abstract Closure with no parameters that captures name and env and performs the following steps when called:
  //   a. Return env.GetBindingValue(name, false).
  const getterClosure = () => env.GetBindingValue(name, false);
  // 2. Let getter be ! CreateBuiltinFunction(getterClosure, 0, "", « »).
  const getter = X(CreateBuiltinFunction(getterClosure, 0, Value(''), ['Name', 'Env']));
  // 3. NOTE: getter is never directly accessible to ECMAScript code.
  // 4. Return getter.
  return getter;
}

/** https://tc39.es/ecma262/#sec-makeargsetter */
function MakeArgSetter(name: string, env: EnvironmentRecord) {
  // 1. Let setterClosure be a new Abstract Closure with parameters (value) that captures name and env and performs the following steps when called:
  //   a. Return env.SetMutableBinding(name, value, false).
  const setterClosure = ([value = Value.undefined]: Arguments) => env.SetMutableBinding(name, value, false);
  // 2. Let setter be ! CreateBuiltinFunction(setterClosure, 1, "", « »).
  const setter = X(CreateBuiltinFunction(setterClosure, 1, Value(''), ['Name', 'Env']));
  // 3. NOTE: setter is never directly accessible to ECMAScript code.
  // 4. Return setter.
  return setter;
}

/** https://tc39.es/ecma262/#sec-createmappedargumentsobject */
export function CreateMappedArgumentsObject(func: ECMAScriptFunctionObject, formals: ParseNode.FormalParameters, argumentsList: Arguments, env: EnvironmentRecord) {
  // Assert: formals does not contain a rest parameter, any binding
  // patterns, or any initializers. It may contain duplicate identifiers.
  const len = argumentsList.length;
  const obj = X(MakeBasicObject(['Prototype', 'Extensible', 'ParameterMap']));
  obj.GetOwnProperty = ArgumentExoticObject.GetOwnProperty;
  obj.DefineOwnProperty = ArgumentExoticObject.DefineOwnProperty;
  obj.Get = ArgumentExoticObject.Get;
  obj.Set = ArgumentExoticObject.Set;
  obj.Delete = ArgumentExoticObject.Delete;
  obj.Prototype = surroundingAgent.intrinsic('%Object.prototype%');
  const map = OrdinaryObjectCreate(Value.null);
  obj.ParameterMap = map;
  const parameterNames = BoundNames(formals);
  const numberOfParameters = parameterNames.length;
  let index = 0;
  while (index < len) {
    const val = argumentsList[index]!;
    X(CreateDataProperty(obj, X(ToString(F(index))), val));
    index += 1;
  }
  X(DefinePropertyOrThrow(obj, 'length', Descriptor({
    Value: F(len),
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));
  const mappedNames = new globalThis.Set<string>();
  index = numberOfParameters - 1;
  while (index >= 0) {
    const name = parameterNames[index];
    if (!mappedNames.has(name)) {
      mappedNames.add(name);
      if (index < len) {
        const g = MakeArgGetter(name, env);
        const p = MakeArgSetter(name, env);
        X(map.DefineOwnProperty(X(ToString(F(index))), Descriptor({
          Set: p,
          Get: g,
          Enumerable: false,
          Configurable: true,
        })));
      }
    }
    index -= 1;
  }
  X(DefinePropertyOrThrow(obj, wellKnownSymbols.iterator, Descriptor({
    Value: surroundingAgent.intrinsic('%Array.prototype.values%'),
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));
  X(DefinePropertyOrThrow(obj, 'callee', Descriptor({
    Value: func,
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));
  return obj;
}
