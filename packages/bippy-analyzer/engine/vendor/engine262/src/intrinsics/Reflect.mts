import { ObjectValue, Value, type Arguments } from '../value.mts';
import { Q } from '../completion.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  Construct,
  CreateArrayFromList,
  CreateListFromArrayLike,
  FromPropertyDescriptor,
  IsCallable,
  IsConstructor,
  PerformTailCall,
  Realm,
  Throw,
  ToPropertyDescriptor,
  ToPropertyKey,
  type FunctionObject,
} from '#self';

/** https://tc39.es/ecma262/#sec-reflect.apply */
function* Reflect_apply([target = Value.undefined, thisArgument = Value.undefined, argumentsList = Value.undefined]: Arguments) {
  // 1. If IsCallable(target) is false, throw a TypeError exception.
  if (!IsCallable(target)) {
    return Throw.TypeError('$1 is not a function', target);
  }
  // 2. Let args be ? CreateListFromArrayLike(argumentsList).
  const args = Q(yield* CreateListFromArrayLike(argumentsList));
  // 3. Perform PrepareForTailCall().
  // 4. Return ? Call(target, thisArgument, args).
  return Q(yield* PerformTailCall(target, thisArgument, args));
}

/** https://tc39.es/ecma262/#sec-reflect.construct */
function* Reflect_construct([target = Value.undefined, argumentsList = Value.undefined, newTarget]: Arguments) {
  // 1. If IsConstructor(target) is false, throw a TypeError exception.
  if (!IsConstructor(target)) {
    return Throw.TypeError('$1 is not a constructor', target);
  }
  // 2. If newTarget is not present, set newTarget to target.
  if (newTarget === undefined) {
    newTarget = target;
  } else if (!IsConstructor(newTarget)) { // 3. Else if IsConstructor(newTarget) is false, throw a TypeError exception.
    return Throw.TypeError('$1 is not a constructor', newTarget);
  }
  // 4. Let args be ? CreateListFromArrayLike(argumentsList).
  const args = Q(yield* CreateListFromArrayLike(argumentsList));
  // 5. Return ? Construct(target, args, newTarget).
  return Q(yield* Construct(target, args, newTarget as FunctionObject));
}

/** https://tc39.es/ecma262/#sec-reflect.defineproperty */
function* Reflect_defineProperty([target = Value.undefined, propertyKey = Value.undefined, attributes = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. Let desc be ? ToPropertyDescriptor(attributes).
  const desc = Q(yield* ToPropertyDescriptor(attributes));
  // 4. Return ? target.[[DefineOwnProperty]](key, desc).
  return Value(Q(yield* target.DefineOwnProperty(key, desc)));
}

/** https://tc39.es/ecma262/#sec-reflect.deleteproperty */
function* Reflect_deleteProperty([target = Value.undefined, propertyKey = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. Return ? target.[[Delete]](key).
  return Value(Q(yield* target.Delete(key)));
}

/** https://tc39.es/ecma262/#sec-reflect.get */
function* Reflect_get([target = Value.undefined, propertyKey = Value.undefined, receiver]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. If receiver is not present, then
  if (receiver === undefined) {
    // a. Set receiver to target.
    receiver = target;
  }
  // 4. Return ? target.[[Get]](key, receiver).
  return Q(yield* target.Get(key, receiver));
}

/** https://tc39.es/ecma262/#sec-reflect.getownpropertydescriptor */
function* Reflect_getOwnPropertyDescriptor([target = Value.undefined, propertyKey = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. Let desc be ? target.[[GetOwnProperty]](key).
  const desc = Q(yield* target.GetOwnProperty(key));
  // 4. Return FromPropertyDescriptor(desc).
  return FromPropertyDescriptor(desc);
}

/** https://tc39.es/ecma262/#sec-reflect.getprototypeof */
function* Reflect_getPrototypeOf([target = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Return ? target.[[GetPrototypeOf]]().
  return Q(yield* target.GetPrototypeOf());
}

/** https://tc39.es/ecma262/#sec-reflect.has */
function* Reflect_has([target = Value.undefined, propertyKey = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. Return ? target.[[HasProperty]](key).
  return Value(Q(yield* target.HasProperty(key)));
}

/** https://tc39.es/ecma262/#sec-reflect.isextensible */
function* Reflect_isExtensible([target = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Return ? target.[[IsExtensible]]().
  return Value(Q(yield* target.IsExtensible()));
}

/** https://tc39.es/ecma262/#sec-reflect.ownkeys */
function* Reflect_ownKeys([target = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let keys be ? target.[[OwnPropertyKeys]]().
  const keys = Q(yield* target.OwnPropertyKeys());
  // 3. Return CreateArrayFromList(keys).
  return CreateArrayFromList(keys);
}

/** https://tc39.es/ecma262/#sec-reflect.preventextensions */
function* Reflect_preventExtensions([target = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Return ? target.[[PreventExtensions]]().
  return Value(Q(yield* target.PreventExtensions()));
}

/** https://tc39.es/ecma262/#sec-reflect.set */
function* Reflect_set([target = Value.undefined, propertyKey = Value.undefined, V = Value.undefined, receiver]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. If receiver is not present, then
  if (receiver === undefined) {
    receiver = target;
  }
  // 4. Return ? target.[[Set]](key, V, receiver).
  return Value(Q(yield* target.Set(key, V, receiver)));
}

/** https://tc39.es/ecma262/#sec-reflect.setprototypeof */
function* Reflect_setPrototypeOf([target = Value.undefined, proto = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. If Type(proto) is not Object and proto is not null, throw a TypeError exception.
  if (!(proto instanceof ObjectValue) && proto !== Value.null) {
    return Throw.TypeError('Object prototype must be an object or null');
  }
  // 3. Return ? target.[[SetPrototypeOf]](proto).
  return Value(Q(yield* target.SetPrototypeOf(proto)));
}

export function bootstrapReflect(realmRec: Realm) {
  const reflect = bootstrapPrototype(realmRec, [
    ['apply', Reflect_apply, 3],
    ['construct', Reflect_construct, 2],
    ['defineProperty', Reflect_defineProperty, 3],
    ['deleteProperty', Reflect_deleteProperty, 2],
    ['get', Reflect_get, 2],
    ['getOwnPropertyDescriptor', Reflect_getOwnPropertyDescriptor, 2],
    ['getPrototypeOf', Reflect_getPrototypeOf, 1],
    ['has', Reflect_has, 2],
    ['isExtensible', Reflect_isExtensible, 1],
    ['ownKeys', Reflect_ownKeys, 1],
    ['preventExtensions', Reflect_preventExtensions, 1],
    ['set', Reflect_set, 3],
    ['setPrototypeOf', Reflect_setPrototypeOf, 2],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Reflect');

  realmRec.Intrinsics['%Reflect%'] = reflect;
}
