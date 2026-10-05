import {
  UndefinedValue, NullValue, ObjectValue, Value,
  type ObjectInternalMethods,
} from '../value.mts';
import {
  Q, X,
  type ValueCompletion,
} from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { PropertyKeyMap } from '../utils/container.mts';
import { markCallContinuation } from '../../../../src/execution-machine.ts';
import type { ProxyObject } from '../intrinsics/Proxy.mts';
import {
  Assert,
  MakeBasicObject,
  IsConstructor,
  IsCallable,
  Call,
  Construct,
  GetMethod,
  CreateArrayFromList,
  CreateListFromArrayLike,
  IsExtensible,
  IsPropertyKey,
  SameValue,
  ToBoolean,
  ToPropertyDescriptor,
  FromPropertyDescriptor,
  CompletePropertyDescriptor,
  IsCompatiblePropertyDescriptor,
  IsDataDescriptor,
  IsAccessorDescriptor,
} from './all.mts';
import { Throw, type FullyPopulatedDescriptor, type PlainEvaluator } from '#self';

const InternalMethods = {
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-getprototypeof */
  * GetPrototypeOf() {
    const O = this;

    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'getPrototypeOf');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget as ObjectValue;
    const trap = Q(yield* GetMethod(handler, 'getPrototypeOf'));
    if (trap === Value.undefined) {
      return Q(yield* target.GetPrototypeOf());
    }
    const handlerProto = Q(yield* Call(trap, handler, [target]));
    if (!(handlerProto instanceof ObjectValue) && !(handlerProto instanceof NullValue)) {
      return Throw.TypeError("'getPrototypeOf' on proxy: trap returned neither object nor null");
    }
    const extensibleTarget = Q(yield* IsExtensible(target));
    if (extensibleTarget) {
      return handlerProto;
    }
    const targetProto = Q(yield* target.GetPrototypeOf());
    if (!SameValue(handlerProto, targetProto)) {
      return Throw.TypeError("'getPrototypeOf' on proxy: proxy target is non-extensible but the trap did not return its actual prototype");
    }
    return handlerProto;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-setprototypeof-v */
  * SetPrototypeOf(V): PlainEvaluator<boolean> {
    const O = this;

    Assert(V instanceof ObjectValue || V instanceof NullValue);
    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'setPrototypeOf');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget as ObjectValue;
    const trap = Q(yield* GetMethod(handler, 'setPrototypeOf'));
    if (trap === Value.undefined) {
      return Q(yield* target.SetPrototypeOf(V));
    }
    const booleanTrapResult = ToBoolean(Q(yield* Call(trap, handler, [target, V])));
    if (!booleanTrapResult) {
      return false;
    }
    const extensibleTarget = Q(yield* IsExtensible(target));
    if (extensibleTarget) {
      return true;
    }
    const targetProto = Q(yield* target.GetPrototypeOf());
    if (!SameValue(V, targetProto)) {
      return Throw.TypeError("'setPrototypeOf' on proxy: trap returned truthy for setting a new prototype on the non-extensible proxy target");
    }
    return true;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-isextensible */
  * IsExtensible() {
    const O = this;

    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'isExtensible');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget;
    const trap = Q(yield* GetMethod(handler, 'isExtensible'));
    if (trap === Value.undefined) {
      return Q(yield* IsExtensible(target as ObjectValue));
    }
    const booleanTrapResult = ToBoolean(Q(yield* Call(trap, handler, [target])));
    const targetResult = Q(yield* IsExtensible(target as ObjectValue));
    if (booleanTrapResult !== targetResult) {
      return Throw.TypeError("'isExtensible' on proxy: trap result does not reflect extensibility of proxy target (which is $1)", Value(targetResult));
    }
    return booleanTrapResult;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-preventextensions */
  * PreventExtensions() {
    const O = this;

    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'preventExtensions');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget as ObjectValue;
    const trap = Q(yield* GetMethod(handler, 'preventExtensions'));
    if (trap === Value.undefined) {
      return Q(yield* target.PreventExtensions());
    }
    const booleanTrapResult = ToBoolean(Q(yield* Call(trap, handler, [target])));
    if (booleanTrapResult) {
      const extensibleTarget = Q(yield* IsExtensible(target));
      if (extensibleTarget) {
        return Throw.TypeError("'preventExtensions' on proxy: trap returned truthy but the proxy target is extensible");
      }
    }
    return booleanTrapResult;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-getownproperty-p */
  * GetOwnProperty(P): PlainEvaluator<FullyPopulatedDescriptor | undefined> {
    const O = this;
    if (typeof P === 'string') P = Value(P);

    // 1. Assert: IsPropertyKey(P) is true.
    Assert(IsPropertyKey(P));
    // 2. Let handler be O.[[ProxyHandler]].
    const handler = O.ProxyHandler;
    // 3. If handler is null, throw a TypeError exception.
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'getOwnPropertyDescriptor');
    }
    // 4. Assert: Type(Handler) is Object.
    Assert(handler instanceof ObjectValue);
    // 5. Let target be O.[[ProxyTarget]].
    const target = O.ProxyTarget as ObjectValue;
    // 6. Let trap be ? Getmethod(handler, "getOwnPropertyDescriptor").
    const trap = Q(yield* GetMethod(handler, 'getOwnPropertyDescriptor'));
    // 7. If trap is undefined, then
    if (trap === Value.undefined) {
      // a. Return ? target.[[GetOwnProperty]](P).
      return Q(yield* target.GetOwnProperty(P));
    }
    // 8. Let trapResultObj be ? Call(trap, handler, « target, P »).
    const trapResultObj = Q(yield* Call(trap, handler, [target, P]));
    // 9. If Type(trapResultObj) is neither Object nor Undefined, throw a TypeError exception.
    if (!(trapResultObj instanceof ObjectValue) && !(trapResultObj instanceof UndefinedValue)) {
      return Throw.TypeError("'getOwnPropertyDescriptor' on proxy: trap returned neither object nor undefined for property $1", P);
    }
    // 10. Let targetDesc be ? target.[[GetOwnProperty]](P).
    const targetDesc = Q(yield* target.GetOwnProperty(P));
    // 11. If trapResultObj is undefined, then
    if (trapResultObj === Value.undefined) {
    // a. If targetDesc is undefined, return undefined.
      if (!targetDesc) {
        return undefined;
      }
      // b. If targetDesc.[[Configurable]] is false, throw a TypeError exception.
      if (!targetDesc.Configurable) {
        return Throw.TypeError("'getOwnPropertyDescriptor' on proxy: trap returned undefined for property $1 which is non-configurable in the proxy target", P);
      }
      // c. Let extensibleTarget be ? IsExtensible(target).
      const extensibleTarget = Q(yield* IsExtensible(target));
      // d. If extensibleTarget is false, throw a TypeError exception.
      if (!extensibleTarget) {
        return Throw.TypeError("'getOwnPropertyDescriptor' on proxy: trap returned undefined for property $1 which exists in the non-extensible target", P);
      }
      // e. Return undefined.
      return undefined;
    }
    // 12. Let extensibleTarget be ? IsExtensible(target).
    const extensibleTarget = Q(yield* IsExtensible(target));
    // 13. Let resultDesc be ? ToPropertyDescriptor(trapResultObj).
    let resultDesc = Q(yield* ToPropertyDescriptor(trapResultObj));
    // 14. Call CompletePropertyDescriptor(resultDesc).
    resultDesc = CompletePropertyDescriptor(resultDesc);
    // 15. Let valid be IsCompatiblePropertyDescriptor(extensibleTarget, resultDesc, targetDesc).
    const valid = IsCompatiblePropertyDescriptor(extensibleTarget, resultDesc, targetDesc);
    // 16. If valid is false, throw a TypeError exception.
    if (!valid) {
      return Throw.TypeError("'getOwnPropertyDescriptor' on proxy: trap returned descriptor for property $1 that is incompatible with the existing property in the proxy target", P);
    }
    // 17. If resultDesc.[[Configurable]] is false, then
    if (!resultDesc.Configurable) {
    // a. If targetDesc is undefined or targetDesc.[[Configurable]] is true, then
      if (!targetDesc || targetDesc.Configurable) {
        // i. Throw a TypeError exception.
        return Throw.TypeError("'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for property $1 which is either non-existent or configurable in the proxy target", P);
      }
      // b. If resultDesc has a [[Writable]] field and resultDesc.[[Writable]] is false, then
      if ('Writable' in resultDesc && !resultDesc.Writable) {
        // i. If targetDesc.[[Writable]] is true, throw a TypeError exception.
        if (targetDesc.Writable) {
          return Throw.TypeError("'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for property $1 which is writable or configurable in the proxy target", P);
        }
      }
    }
    // 18. Return resultDesc.
    return resultDesc as FullyPopulatedDescriptor;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-defineownproperty-p-desc */
  * DefineOwnProperty(P, Desc): PlainEvaluator<boolean> {
    const O = this;
    if (typeof P === 'string') P = Value(P);

    // 1. Assert: IsPropertyKey(P) is true.
    Assert(IsPropertyKey(P));
    // 2. Let handler be O.[[ProxyHandler]].
    const handler = O.ProxyHandler;
    // 3. If handler is null, throw a TypeError exception.
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'defineProperty');
    }
    // 4. Assert: Type(handler) is Object.
    Assert(handler instanceof ObjectValue);
    // 5. Let target be O.[[ProxyTarget]].
    const target = O.ProxyTarget as ObjectValue;
    // 6. Let trap be ? GetMethod(handler, "defineProperty").
    const trap = Q(yield* GetMethod(handler, 'defineProperty'));
    // 7. If trap is undefined, then
    if (trap === Value.undefined) {
      // a. Return ? target.[[DefineOwnProperty]](P, Desc).
      return Q(yield* target.DefineOwnProperty(P, Desc));
    }
    // 8. Let descObj be FromPropertyDescriptor(Desc).
    const descObj = FromPropertyDescriptor(Desc);
    // 9. Let booleanTrapResult be ! ToBoolean(? Call(trap, handler, « target, P, descObj »)).
    const booleanTrapResult = ToBoolean(Q(yield* Call(trap, handler, [target, P, descObj])));
    // 10. If booleanTrapResult is false, return false.
    if (!booleanTrapResult) {
      return false;
    }
    // 11. Let targetDesc be ? target.[[GetOwnProperty]](P).
    const targetDesc = Q(yield* target.GetOwnProperty(P));
    // 12. Let extensibleTarget be ? IsExtensible(target).
    const extensibleTarget = Q(yield* IsExtensible(target));
    let settingConfigFalse;
    // 13. If Desc has a [[Configurable]] field and if Desc.[[Configurable]] is false, then
    if (Desc.Configurable !== undefined && !Desc.Configurable) {
      // a. Let settingConfigFalse be true.
      settingConfigFalse = true;
    } else {
      // Else, let settingConfigFalse be false.
      settingConfigFalse = false;
    }
    // 15. If targetDesc is undefined, then
    if (!targetDesc) {
      // a. If extensibleTarget is false, throw a TypeError exception.
      if (!extensibleTarget) {
        return Throw.TypeError("'defineProperty' on proxy: trap returned truthy for adding property $1 to the non-extensible proxy target", P);
      }
      // b. If settingConfigFalse is true, throw a TypeError exception.
      if (settingConfigFalse) {
        return Throw.TypeError("'defineProperty' on proxy: trap returned truthy for defining non-configurable property $1 which is either non-existent or configurable in the proxy target", P);
      }
    } else {
      // a. If IsCompatiblePropertyDescriptor(extensibleTarget, Desc, targetDesc) is false, throw a TypeError exception.
      if (!IsCompatiblePropertyDescriptor(extensibleTarget, Desc, targetDesc)) {
        return Throw.TypeError("'defineProperty' on proxy: trap returned truthy for adding property $1 that is incompatible with the existing property in the proxy target", P);
      }
      // b. If settingConfigFalse is true and targetDesc.[[Configurable]] is true, throw a TypeError exception.
      if (settingConfigFalse && targetDesc.Configurable) {
        return Throw.TypeError("'defineProperty' on proxy: trap returned truthy for defining non-configurable property $1 which is either non-existent or configurable in the proxy target", P);
      }
      // c. If IsDataDescriptor(targetDesc) is true, targetDesc.[[Configurable]] is false, and targetDesc.[[Writable]] is true, then
      if (IsDataDescriptor(targetDesc) && !targetDesc.Configurable && targetDesc.Writable) {
        // i. If Desc has a [[Writable]] field and Desc.[[Writable]] is false, throw a TypeError exception.
        if (Desc.Writable === false) {
          return Throw.TypeError("'defineProperty' on proxy: trap returned truthy for defining non-configurable property $1 which cannot be non-writable, unless there exists a corresponding non-configurable, non-writable own property of the target object", P);
        }
      }
    }
    return true;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-hasproperty-p */
  * HasProperty(P): PlainEvaluator<boolean> {
    const O = this;
    if (typeof P === 'string') P = Value(P);

    Assert(IsPropertyKey(P));
    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'has');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget as ObjectValue;
    const trap = Q(yield* GetMethod(handler, 'has'));
    if (trap === Value.undefined) {
      return Q(yield* target.HasProperty(P));
    }
    const booleanTrapResult = ToBoolean(Q(yield* Call(trap, handler, [target, P])));
    if (!booleanTrapResult) {
      const targetDesc = Q(yield* target.GetOwnProperty(P));
      if (targetDesc) {
        if (!targetDesc.Configurable) {
          return Throw.TypeError("'has' on proxy: trap returned falsy for property $1 which exists in the proxy target as non-configurable", P);
        }
        const extensibleTarget = Q(yield* IsExtensible(target));
        if (!extensibleTarget) {
          return Throw.TypeError("'has' on proxy: trap returned falsy for property $1 but the proxy target is not extensible", P);
        }
      }
    }
    return booleanTrapResult;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-get-p-receiver */
  * Get(P, Receiver) {
    const O = this;
    if (typeof P === 'string') P = Value(P);

    Assert(IsPropertyKey(P));
    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'get');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget as ObjectValue;
    const trap = Q(yield* GetMethod(handler, 'get'));
    if (trap === Value.undefined) {
      return Q(yield* target.Get(P, Receiver));
    }
    const trapResult = Q(yield* Call(trap, handler, [target, P, Receiver]));
    const targetDesc = Q(yield* target.GetOwnProperty(P));
    if (targetDesc && !targetDesc.Configurable) {
      if (IsDataDescriptor(targetDesc) === true && !targetDesc.Writable) {
        if (!SameValue(trapResult, targetDesc.Value)) {
          return Throw.TypeError("'get' on proxy: property $1 is a read-only and non-configurable data property on the proxy target but the proxy did not return its actual value", P);
        }
      }
      if (IsAccessorDescriptor(targetDesc) === true && targetDesc.Get === Value.undefined) {
        if (trapResult !== Value.undefined) {
          return Throw.TypeError("'get' on proxy: property $1 is a non-configurable accessor property on the proxy target and does not have a getter function, but the trap did not return 'undefined'", P);
        }
      }
    }
    return trapResult;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-set-p-v-receiver */
  * Set(P, V, Receiver): PlainEvaluator<boolean> {
    const O = this;
    if (typeof P === 'string') P = Value(P);

    Assert(IsPropertyKey(P));
    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'set');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget as ObjectValue;
    const trap = Q(yield* GetMethod(handler, 'set'));
    if (trap === Value.undefined) {
      return Q(yield* target.Set(P, V, Receiver));
    }
    const booleanTrapResult = ToBoolean(Q(yield* Call(trap, handler, [target, P, V, Receiver])));
    if (!booleanTrapResult) {
      return false;
    }
    const targetDesc = Q(yield* target.GetOwnProperty(P));
    if (targetDesc && !targetDesc.Configurable) {
      if (IsDataDescriptor(targetDesc) === true && !targetDesc.Writable) {
        if (!SameValue(V, targetDesc.Value)) {
          return Throw.TypeError("'set' on proxy: trap returned truthy for property $1 which exists in the proxy target as a non-configurable and non-writable data property with a different value", P);
        }
      }
      if (IsAccessorDescriptor(targetDesc) === true) {
        if (targetDesc.Set === Value.undefined) {
          return Throw.TypeError("'set' on proxy: trap returned truthy for property $1 which exists in the proxy target as a non-configurable and non-writable accessor property without a setter", P);
        }
      }
    }
    return true;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-delete-p */
  * Delete(P): PlainEvaluator<boolean> {
    const O = this;
    if (typeof P === 'string') P = Value(P);

    // 1. Assert: IsPropertyKey(P) is true.
    Assert(IsPropertyKey(P));
    // 2. Let handler be O.[[ProxyHandler]].
    const handler = O.ProxyHandler;
    // 3. If handler is null, throw a TypeError exception.
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'deleteProperty');
    }
    // 4. Assert: Type(handler) is Object.
    Assert(handler instanceof ObjectValue);
    // 5. Let target be O.[[ProxyTarget]].
    const target = O.ProxyTarget as ObjectValue;
    // 6. Let trap be ? GetMethod(handler, "deleteProperty").
    const trap = Q(yield* GetMethod(handler, 'deleteProperty'));
    // 7. If trap is undefined, then
    if (trap === Value.undefined) {
      // a. Return ? target.[[Delete]](P).
      return Q(yield* target.Delete(P));
    }
    // 8. Let booleanTrapResult be ! ToBoolean(? Call(trap, handler, « target, P »)).
    const booleanTrapResult = ToBoolean(Q(yield* Call(trap, handler, [target, P])));
    // 9. If booleanTrapResult is false, return false.
    if (!booleanTrapResult) {
      return false;
    }
    // 10. Let targetDesc be ? target.[[GetOwnProperty]](P).
    const targetDesc = Q(yield* target.GetOwnProperty(P));
    // 11. If targetDesc is undefined, return true.
    if (!targetDesc) {
      return true;
    }
    // 12. If targetDesc.[[Configurable]] is false, throw a TypeError exception.
    if (!targetDesc.Configurable) {
      return Throw.TypeError("'deleteProperty' on proxy: trap returned truthy for property $1 which is non-configurable in the proxy target", P);
    }
    // 13. Let extensibleTarget be ? IsExtensible(target).
    const extensibleTarget = Q(yield* IsExtensible(target));
    // 14. If extensibleTarget is false, throw a TypeError exception.
    if (!extensibleTarget) {
      return Throw.TypeError("'deleteProperty' on proxy: trap returned truthy for property $1 but the proxy target is non-extensible", P);
    }
    // 15. Return true.
    return true;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-ownpropertykeys */
  * OwnPropertyKeys() {
    const O = this;

    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'ownKeys');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget as ObjectValue;
    const trap = Q(yield* GetMethod(handler, 'ownKeys'));
    if (trap === Value.undefined) {
      return Q(yield* target.OwnPropertyKeys());
    }
    const trapResultArray = Q(yield* Call(trap, handler, [target]));
    const trapResult = Q(yield* CreateListFromArrayLike(trapResultArray, 'property-key'));
    const noDuplicate = new PropertyKeyMap();
    trapResult.forEach((key) => {
      noDuplicate.set(key, true);
    });
    if (noDuplicate.size !== trapResult.length) {
      return Throw.TypeError("'ownKeys' on proxy: trap returned duplicate entries");
    }
    const extensibleTarget = Q(yield* IsExtensible(target));
    const targetKeys = Q(yield* target.OwnPropertyKeys());
    // Assert: targetKeys is a List containing only String and Symbol values.
    // Assert: targetKeys contains no duplicate entries.
    const targetConfigurableKeys = [];
    const targetNonconfigurableKeys = [];
    for (const key of targetKeys) {
      const desc = Q(yield* target.GetOwnProperty(key));
      if (desc && !desc.Configurable) {
        targetNonconfigurableKeys.push(key);
      } else {
        targetConfigurableKeys.push(key);
      }
    }
    if (extensibleTarget && targetNonconfigurableKeys.length === 0) {
      return trapResult;
    }
    const uncheckedResultKeys = new PropertyKeyMap();
    trapResult.forEach((key) => {
      uncheckedResultKeys.set(key, true);
    });
    for (const key of targetNonconfigurableKeys) {
      if (!uncheckedResultKeys.has(key)) {
        return Throw.TypeError("'ownKeys' on proxy: trap result did not include $1", 'non-configurable key');
      }
      uncheckedResultKeys.delete(key);
    }
    if (extensibleTarget) {
      return trapResult;
    }
    for (const key of targetConfigurableKeys) {
      if (!uncheckedResultKeys.has(key)) {
        return Throw.TypeError("'ownKeys' on proxy: trap result did not include $1", 'configurable key');
      }
      uncheckedResultKeys.delete(key);
    }
    if (uncheckedResultKeys.size > 0) {
      return Throw.TypeError("'ownKeys' on proxy: trap result returned extra keys but proxy target is non-extensible");
    }
    return trapResult;
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-call-thisargument-argumentslist */
  * Call(thisArgument, argumentsList) {
    markCallContinuation();
    const O = this;

    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'apply');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget;
    const trap = Q(yield* GetMethod(handler, 'apply'));
    if (trap === Value.undefined) {
      return Q(yield* Call(target, thisArgument, argumentsList));
    }
    const argArray = X(CreateArrayFromList(argumentsList));
    return Q(yield* Call(trap, handler, [target, thisArgument, argArray]));
  },
  /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-construct-argumentslist-newtarget */
  * Construct(argumentsList, newTarget) {
    const O = this;

    const handler = O.ProxyHandler;
    if (handler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'construct');
    }
    Assert(handler instanceof ObjectValue);
    const target = O.ProxyTarget;
    Assert(IsConstructor(target));
    const trap = Q(yield* GetMethod(handler, 'construct'));
    if (trap === Value.undefined) {
      return Q(yield* Construct(target, argumentsList, newTarget));
    }
    const argArray = X(CreateArrayFromList(argumentsList));
    const newObj = Q(yield* Call(trap, handler, [target, argArray, newTarget]));
    if (!(newObj instanceof ObjectValue)) {
      return Throw.TypeError('$1 is not an object', newObj);
    }
    return newObj;
  },
} satisfies ObjectInternalMethods<ProxyObject>;

/** https://tc39.es/ecma262/#sec-proxycreate */
export function ProxyCreate(target: Value, handler: Value): ValueCompletion<ProxyObject> {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('Cannot create a proxy with a $1 as $2', 'non-object', 'target');
  }
  // 2. If Type(handler) is not Object, throw a TypeError exception.
  if (!(handler instanceof ObjectValue)) {
    return Throw.TypeError('Cannot create a proxy with a $1 as $2', 'non-object', 'handler');
  }
  // 3. Let P be ! MakeBasicObject(« [[ProxyHandler]], [[ProxyTarget]] »).
  const P = X(MakeBasicObject(['ProxyHandler', 'ProxyTarget'])) as ProxyObject;
  // 4. Set P's essential internal methods, except for [[Call]] and [[Construct]], to the definitions specified in 9.5.
  P.GetPrototypeOf = InternalMethods.GetPrototypeOf;
  P.SetPrototypeOf = InternalMethods.SetPrototypeOf;
  P.IsExtensible = InternalMethods.IsExtensible;
  P.PreventExtensions = InternalMethods.PreventExtensions;
  P.GetOwnProperty = InternalMethods.GetOwnProperty;
  P.DefineOwnProperty = InternalMethods.DefineOwnProperty;
  P.HasProperty = InternalMethods.HasProperty;
  P.Get = InternalMethods.Get;
  P.Set = InternalMethods.Set;
  P.Delete = InternalMethods.Delete;
  P.OwnPropertyKeys = InternalMethods.OwnPropertyKeys;
  // 5. If IsCallable(target) is true, then
  if (IsCallable(target)) {
    /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-call-thisargument-argumentslist. */
    P.Call = InternalMethods.Call;
    // b. If IsConstructor(target) is true, then
    if (IsConstructor(target)) {
      /** https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-construct-argumentslist-newtarget. */
      P.Construct = InternalMethods.Construct;
    }
  }
  // 6. Set P.[[ProxyTarget]] to target.
  P.ProxyTarget = target;
  // 7. Set P.[[ProxyHandler]] to handler.
  P.ProxyHandler = handler;
  // 8. Return P.
  return P;
}
