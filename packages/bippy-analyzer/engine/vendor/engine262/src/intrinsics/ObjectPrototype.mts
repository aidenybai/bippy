import {
  NullValue,
  JSStringValue,
  ObjectValue,
  Value,
  Descriptor,
  wellKnownSymbols,
  type FunctionCallContext,
  type Arguments,
  type ObjectInternalMethods,
} from '../value.mts';
import {
  Q, X, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import { assignProps } from './bootstrap.mts';
import {
  DefinePropertyOrThrow,
  Get,
  HasOwnProperty,
  Invoke,
  IsAccessorDescriptor,
  IsArray,
  IsCallable,
  MakeBasicObject,
  Realm,
  RequireObjectCoercible,
  SameValue,
  SetImmutablePrototype,
  Throw,
  ToObject,
  ToPropertyKey,
  type BuiltinFunctionObject,
  type FunctionObject,
  type ImmutablePrototypeObject,
  type OrdinaryObject,
} from '#self';

/** https://tc39.es/ecma262/#sec-object.prototype.hasownproperty */
function* ObjectProto_hasOwnProperty([V = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let P be ? ToPropertyKey(V).
  const P = Q(yield* ToPropertyKey(V));
  // 2. Let O be ? ToObject(this value).
  const O = Q(ToObject(thisValue));
  // 3. Return ? HasOwnProperty(O, P).
  return Value(Q(yield* HasOwnProperty(O, P)));
}

/** https://tc39.es/ecma262/#sec-object.prototype.isprototypeof */
function* ObjectProto_isPrototypeOf([V = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. If Type(V) is not Object, return false.
  if (!(V instanceof ObjectValue)) {
    return Value.false;
  }
  // 2. Let O be ? ToObject(this value).
  const O = Q(ToObject(thisValue));
  // 3. Repeat,
  while (true) {
    // a. Set V to ? V.[[GetPrototypeOf]]().
    V = Q(yield* (V as ObjectValue).GetPrototypeOf());
    // b. If V is null, return false.
    if (V === Value.null) {
      return Value.false;
    }
    // c. If SameValue(O, V) is true, return true.
    if (SameValue(O, V)) {
      return Value.true;
    }
  }
}

/** https://tc39.es/ecma262/#sec-object.prototype.propertyisenumerable */
function* ObjectProto_propertyIsEnumerable([V = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let P be ? ToPropertyKey(V).
  const P = Q(yield* ToPropertyKey(V));
  // 2. Let O be ? ToObject(this value).
  const O = Q(ToObject(thisValue));
  // 3. Let desc be ? O.[[GetOwnProperty]](P).
  const desc = Q(yield* O.GetOwnProperty(P));
  // 4. If desc is undefined, return false.
  if (!desc) {
    return Value.false;
  }
  // 5. Return desc.[[Enumerable]].
  return Value(desc.Enumerable);
}

/** https://tc39.es/ecma262/#sec-object.prototype.tolocalestring */
function* ObjectProto_toLocaleString(_argList: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be the this value.
  const O = thisValue;
  // 2. Return ? Invoke(O, "toString").
  return Q(yield* Invoke(O, 'toString'));
}

/** https://tc39.es/ecma262/#sec-object.prototype.tostring */
function* ObjectProto_toString(_argList: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. If the this value is undefined, return "[object Undefined]".
  if (thisValue === Value.undefined) {
    return Value('[object Undefined]');
  }
  // 2. If the this value is null, return "[object Null]".
  if (thisValue === Value.null) {
    return Value('[object Null]');
  }
  // 3. Let O be ! ToObject(this value).
  const O = X(ToObject(thisValue));
  // 4. Let isArray be ? IsArray(O).
  const isArray = Q(IsArray(O));
  let builtinTag;
  // 5. If isArray is true, let builtinTag be "Array".
  if (isArray) {
    builtinTag = 'Array';
  } else if ('ParameterMap' in O) { // 6. Else if O has a [[ParameterMap]] internal slot, let builtinTag be "Arguments".
    builtinTag = 'Arguments';
  } else if ('Call' in O) { // 7. Else if O has a [[Call]] internal method, let builtinTag be "Function".
    builtinTag = 'Function';
  } else if ('ErrorData' in O) { // 8. Else if O has an [[ErrorData]] internal slot, let builtinTag be "Error".
    builtinTag = 'Error';
  } else if ('BooleanData' in O) { // 9. Else if O has a [[BooleanData]] internal slot, let builtinTag be "Boolean".
    builtinTag = 'Boolean';
  } else if ('NumberData' in O) { // 10. Else if O has a [[NumberData]] internal slot, let builtinTag be "Number".
    builtinTag = 'Number';
  } else if ('StringData' in O) { // 11. Else if O has a [[StringData]] internal slot, let builtinTag be "String".
    builtinTag = 'String';
  } else if ('DateValue' in O) { // 12. Else if O has a [[DateValue]] internal slot, let builtinTag be "Date".
    builtinTag = 'Date';
  } else if ('RegExpMatcher' in O) { // 13. Else if O has a [[RegExpMatcher]] internal slot, let builtinTag be "RegExp".
    builtinTag = 'RegExp';
  } else { // 14. Else, let builtinTag be "Object".
    builtinTag = 'Object';
  }
  // 15. Let tag be ? Get(O, @@toStringTag).
  const tag = Q(yield* Get(O, wellKnownSymbols.toStringTag));
  let tagStr;
  // 16. If Type(tag) is not String, set tag to builtinTag.
  if (!(tag instanceof JSStringValue)) {
    tagStr = builtinTag;
  } else {
    tagStr = tag.stringValue();
  }
  // 17. Return the string-concatenation of "[object ", tag, and "]".
  return Value(`[object ${tagStr}]`);
}

/** https://tc39.es/ecma262/#sec-object.prototype.valueof */
function ObjectProto_valueOf(_argList: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Return ? ToObject(this value).
  return Q(ToObject(thisValue));
}

/** https://tc39.es/ecma262/#sec-object.prototype.__defineGetter__ */
function* ObjectProto__defineGetter__([P = Value.undefined, getter = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be ? ToObject(this value).
  const O = Q(ToObject(thisValue));
  // 2. If IsCallable(getter) is false, throw a TypeError exception.
  if (!IsCallable(getter)) {
    return Throw.TypeError('$1 is not a function', getter);
  }
  // 3. Let desc be PropertyDescriptor { [[Get]]: getter, [[Enumerable]]: true, [[Configurable]]: true }.
  const desc = Descriptor({
    Get: getter,
    Enumerable: true,
    Configurable: true,
  });
  // 4. Let key be ? ToPropertyKey(P).
  const key = Q(yield* ToPropertyKey(P));
  // 5. Perform ? DefinePropertyOrThrow(O, key, desc).
  Q(yield* DefinePropertyOrThrow(O, key, desc));
  // 6. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-object.prototype.__defineSetter__ */
function* ObjectProto__defineSetter__([P = Value.undefined, setter = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be ? ToObject(this value).
  const O = Q(ToObject(thisValue));
  // 2. If IsCallable(setter) is false, throw a TypeError exception.
  if (!IsCallable(setter)) {
    return Throw.TypeError('$1 is not a function', setter);
  }
  // 3. Let desc be PropertyDescriptor { [[Set]]: setter, [[Enumerable]]: true, [[Configurable]]: true }.
  const desc = Descriptor({
    Set: setter,
    Enumerable: true,
    Configurable: true,
  });
  // 4. Let key be ? ToPropertyKey(P).
  const key = Q(yield* ToPropertyKey(P));
  // 5. Perform ? DefinePropertyOrThrow(O, key, desc).
  Q(yield* DefinePropertyOrThrow(O, key, desc));
  // 6. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-object.prototype.__lookupGetter__ */
function* ObjectProto__lookupGetter__([P = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be ? ToObject(this value).
  let O: NullValue | ObjectValue = Q(ToObject(thisValue));
  // 2. Let key be ? ToPropertyKey(P).
  const key = Q(yield* ToPropertyKey(P));
  // 3. Repeat,
  while (true) {
    __ts_cast__<ObjectValue>(O);
    // a. Let desc be ? O.[[GetOwnProperty]](key).
    const desc = Q(yield* O.GetOwnProperty(key));
    // b. If desc is not undefined, then
    if (desc) {
      // i. If IsAccessorDescriptor(desc) is true, return desc.[[Get]].
      if (IsAccessorDescriptor(desc)) {
        return desc.Get;
      }
      // ii. Return undefined.
      return Value.undefined;
    }
    // c. Set O to ? O.[[GetPrototypeOf]]().
    O = Q(yield* O.GetPrototypeOf());
    // d. If O is null, return undefined.
    if (O === Value.null) {
      return Value.undefined;
    }
  }
}

/** https://tc39.es/ecma262/#sec-object.prototype.__lookupSetter__ */
function* ObjectProto__lookupSetter__([P = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be ? ToObject(this value).
  let O: NullValue | ObjectValue = Q(ToObject(thisValue));
  // 2. Let key be ? ToPropertyKey(P).
  const key = Q(yield* ToPropertyKey(P));
  // 3. Repeat,
  while (true) {
    __ts_cast__<ObjectValue>(O);
    // a. Let desc be ? O.[[GetOwnProperty]](key).
    const desc = Q(yield* O.GetOwnProperty(key));
    // b. If desc is not undefined, then
    if (desc) {
      // i. If IsAccessorDescriptor(desc) is true, return desc.[[Set]].
      if (IsAccessorDescriptor(desc)) {
        return desc.Set;
      }
      // ii. Return undefined.
      return Value.undefined;
    }
    // c. Set O to ? O.[[GetPrototypeOf]]().
    O = Q(yield* O.GetPrototypeOf());
    // d. If O is null, return undefined.
    if (O === Value.null) {
      return Value.undefined;
    }
  }
}

/** https://tc39.es/ecma262/#sec-get-object.prototype.__proto__ */
function* ObjectProto___proto___getter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be ? ToObject(this value).
  const O = Q(ToObject(thisValue));
  // 2. Return ? O.[[GetPrototypeOf]]().
  return Q(yield* O.GetPrototypeOf());
}

/** https://tc39.es/ecma262/#sec-set-object.prototype.__proto__ */
function* ObjectProto___proto___setter([proto = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be the *this* value.
  // 2. Perform ? RequireObjectCoercible(this value).
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  // 2. If Type(proto) is neither Object nor Null, return undefined.
  if (!(proto instanceof ObjectValue) && !(proto instanceof NullValue)) {
    return Value.undefined;
  }
  // 3. If Type(O) is not Object, return undefined.
  if (!(O instanceof ObjectValue)) {
    return Value.undefined;
  }
  // 4. Let status be ? O.[[SetPrototypeOf]](proto).
  const status = Q(yield* O.SetPrototypeOf(proto));
  // 5. If status is false, throw a TypeError exception.
  if (!status) {
    return Throw.TypeError('Could not set prototype of object');
  }
  // 6. Return undefined.
  return Value.undefined;
}

const InternalMethods = {
  /** https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-immutable-prototype-exotic-objects-setprototypeof-v */
  * SetPrototypeOf(V) {
    // 1. Return ? SetImmutablePrototype(O, V).
    return Q(yield* SetImmutablePrototype(this, V));
  },
} satisfies Partial<ObjectInternalMethods<ImmutablePrototypeObject>>;

/** https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-properties-of-the-object-prototype-object */
export function makeObjectPrototype(realmRec: Realm) {
  // The Object prototype object:
  const proto = MakeBasicObject(['Prototype', 'Extensible']) as Mutable<ImmutablePrototypeObject & OrdinaryObject>;

  // * has an [[Extensible]] internal slot whose value is true.
  proto.Extensible = true;

  // * has a [[Prototype]] internal slot whose value is null.
  proto.Prototype = Value.null;

  // * has the internal methods defined for ordinary objects, except for the [[SetPrototypeOf]] method, which is as defined in 10.4.7.1.
  //   (Thus, it is an immutable prototype exotic object.)
  proto.SetPrototypeOf = InternalMethods.SetPrototypeOf;

  // * is %Object.prototype%.
  realmRec.Intrinsics['%Object.prototype%'] = proto;
}

export function bootstrapObjectPrototype(realmRec: Realm) {
  const proto = realmRec.Intrinsics['%Object.prototype%'];

  assignProps(realmRec, proto, [
    ['hasOwnProperty', ObjectProto_hasOwnProperty, 1],
    ['isPrototypeOf', ObjectProto_isPrototypeOf, 1],
    ['propertyIsEnumerable', ObjectProto_propertyIsEnumerable, 1],
    ['toLocaleString', ObjectProto_toLocaleString, 0],
    ['toString', ObjectProto_toString, 0],
    ['valueOf', ObjectProto_valueOf, 0],
    ['__defineGetter__', ObjectProto__defineGetter__, 2],
    ['__defineSetter__', ObjectProto__defineSetter__, 2],
    ['__lookupGetter__', ObjectProto__lookupGetter__, 1],
    ['__lookupSetter__', ObjectProto__lookupSetter__, 1],
    ['__proto__', [ObjectProto___proto___getter, ObjectProto___proto___setter]],
  ]);

  realmRec.Intrinsics['%Object.prototype.toString%'] = X(Get(proto, 'toString')) as BuiltinFunctionObject;
  realmRec.Intrinsics['%Object.prototype.valueOf%'] = X(Get(proto, 'valueOf')) as FunctionObject;
}
