import {
  ReferenceRecord,
  Value,
  PrivateName,
  JSStringValue,
  ObjectValue,
} from '../value.mts';
import {
  Q,
  type PlainCompletion,
} from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { ResolvePrivateIdentifier } from '../execution-context/PrivateEnvironment.mts';
import {
  Assert,
  ToObject,
  Set,
  PrivateGet,
  PrivateSet,
  IsPropertyKey,
  ToPropertyKey,
  getActiveScriptId,
} from './all.mts';
import {
  DynamicParsedCodeRecord, surroundingAgent, EnvironmentRecord, GetGlobalObject, Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-ispropertyreference */
export function IsPropertyReference(V: ReferenceRecord): boolean {
  // 1. If V.[[Base]] is unresolvable, return false.
  if (V.Base === 'unresolvable') {
    return false;
  }
  // 2. If V.[[Base]] is an Environment Record, return false; otherwise return true.
  return V.Base instanceof EnvironmentRecord ? false : true;
}
export type PropertyReference = ReferenceRecord & {
  readonly Base: Exclude<ReferenceRecord['Base'], 'unresolvable' | EnvironmentRecord>,
};

/** https://tc39.es/ecma262/#sec-isunresolvablereference */
export function IsUnresolvableReference(V: ReferenceRecord): boolean {
  // 1. Assert: V is a Reference Record.
  Assert(V instanceof ReferenceRecord);
  // 2. If V.[[Base]] is unresolvable, return true; otherwise return false.
  return V.Base === 'unresolvable' ? true : false;
}

/** https://tc39.es/ecma262/#sec-issuperreference */
export function IsSuperReference(V: ReferenceRecord): boolean {
  // 1. Assert: V is a Reference Record.
  Assert(V instanceof ReferenceRecord);
  // 2. If V.[[ThisValue]] is not empty, return true; otherwise return false.
  return V.ThisValue !== undefined ? true : false;
}

/** https://tc39.es/ecma262/#sec-isprivatereference */
export function IsPrivateReference(V: ReferenceRecord): V is ReferenceRecord & { readonly ReferencedName: PrivateName } {
  // 1. Assert: V is a Reference Record.
  Assert(V instanceof ReferenceRecord);
  // 2. If V.[[ReferencedName]] is a Private Name, return true; otherwise return false.
  return V.ReferencedName instanceof PrivateName;
}

/** https://tc39.es/ecma262/#sec-getvalue */
export function* GetValue(V: ReferenceRecord | Value): PlainEvaluator<Value> {
  // 1. If V is not a Reference Record, return V.
  if (!(V instanceof ReferenceRecord)) {
    return V;
  }
  // 2. If IsUnresolvableReference(V) is true, throw a ReferenceError exception.
  if (IsUnresolvableReference(V)) {
    return Throw.ReferenceError('$1 is not defined', V.ReferencedName);
  }
  // 3. If IsPropertyReference(V) is true, then
  if (IsPropertyReference(V)) {
    __ts_cast__<PropertyReference>(V);
    // a. Let baseObj be ? ToObject(V.[[Base]]).
    const baseObj = Q(ToObject(V.Base));
    // b. If IsPrivateReference(V) is true, then
    if (IsPrivateReference(V)) {
      // i. Return ? PrivateGet(baseObj, V.[[ReferencedName]]).
      return Q(yield* PrivateGet(baseObj, V.ReferencedName));
    }
    if (!IsPropertyKey(V.ReferencedName)) {
      V.ReferencedName = Q(yield* ToPropertyKey(V.ReferencedName as Value));
    }
    // c. Return ? baseObj.[[Get]](V.[[ReferencedName]], GetThisValue(V)).
    return Q(yield* baseObj.Get(V.ReferencedName, GetThisValue(V)));
  } else { // 5. Else,
    // a. Let base be V.[[Base]].
    const base = V.Base;
    // b. Assert: base is an Environment Record.
    Assert(base instanceof EnvironmentRecord);
    // c. Return ? base.GetBindingValue(V.[[ReferencedName]], V.[[Strict]]).
    return Q(yield* base.GetBindingValue((V.ReferencedName as JSStringValue).stringValue(), V.Strict));
  }
}

/** https://tc39.es/ecma262/#sec-putvalue */
export function* PutValue(V: ReferenceRecord | Value, W: Value): PlainEvaluator {
  // 1. If V is not a Reference Record, throw a ReferenceError exception.
  if (!(V instanceof ReferenceRecord)) {
    return Throw.ReferenceError('Invalid assignment target');
  }
  // 2. If IsUnresolvableReference(V) is true, then
  if (IsUnresolvableReference(V)) {
    // a. If V.[[Strict]] is true, throw a ReferenceError exception.
    if (V.Strict) {
      return Throw.ReferenceError('$1 is not defined', V.ReferencedName);
    }
    // b. Let globalObj be GetGlobalObject().
    const globalObj = GetGlobalObject();
    // c. Return ? Set(globalObj, V.[[ReferencedName]], W, false).
    Q(yield* Set(globalObj, V.ReferencedName as JSStringValue, W, false));
    return undefined;
  }
  // 5. If IsPropertyReference(V) is true, then
  if (IsPropertyReference(V)) {
    // a. Let baseObj be ? ToObject(V.[[Base]]).
    const baseObj = Q(ToObject(V.Base as JSStringValue));
    // b. If IsPrivateReference(V) is true, then
    if (IsPrivateReference(V)) {
      // i. Return ? PrivateSet(baseObj, V.[[ReferencedName]], W).
      return Q(yield* PrivateSet(baseObj, V.ReferencedName, W));
    }
    if (!IsPropertyKey(V.ReferencedName)) {
      V.ReferencedName = Q(yield* ToPropertyKey(V.ReferencedName as Value));
    }
    // c. Let succeeded be ? baseObj.[[Set]](V.[[ReferencedName]], W, GetThisValue(V)).
    const succeeded = Q(yield* baseObj.Set(V.ReferencedName, W, GetThisValue(V)));
    // d. If succeeded is false and V.[[Strict]] is true, throw a TypeError exception.
    if (!succeeded && V.Strict) {
      return Throw.TypeError('Cannot set property $1 on $2', V.ReferencedName, baseObj);
    }
    // e. Return.
    return undefined;
  } else { // 6. Else,
    // a. Let base be V.[[Base]].
    const base = V.Base;
    // b. Assert: base is an Environment Record.
    Assert(base instanceof EnvironmentRecord);
    // c. Return ? base.SetMutableBinding(V.[[ReferencedName]], W, V.[[Strict]]) (see 9.1).
    return Q(yield* base.SetMutableBinding((V.ReferencedName as JSStringValue).stringValue(), W, V.Strict));
  }
}

/** https://tc39.es/ecma262/#sec-getthisvalue */
export function GetThisValue(V: ReferenceRecord) {
  // 1. Assert: IsPropertyReference(V) is true.
  Assert(IsPropertyReference(V));
  // 2. If IsSuperReference(V) is true, return V.[[ThisValue]]; otherwise return V.[[Base]].
  if (IsSuperReference(V)) {
    return V.ThisValue!;
  } else {
    return V.Base as Value;
  }
}

/** https://tc39.es/ecma262/#sec-initializereferencedbinding */
export function* InitializeReferencedBinding(V: PlainCompletion<ReferenceRecord>, W: Value): PlainEvaluator {
  Q(V);
  Q(W);
  // 3. Assert: V is a Reference Record.
  Assert(V instanceof ReferenceRecord);
  // 4. Assert: IsUnresolvableReference(V) is false.
  Assert(!IsUnresolvableReference(V));
  // 5. Let base be V.[[Base]].
  const base = V.Base;
  // 6. Assert: base is an Environment Record.
  Assert(base instanceof EnvironmentRecord);
  // 7. Return base.InitializeBinding(V.[[ReferencedName]], W).
  return yield* base.InitializeBinding((V.ReferencedName as JSStringValue).stringValue(), W);
}

/** https://tc39.es/ecma262/#sec-makeprivatereference */
export function MakePrivateReference(baseValue: Value, privateIdentifier: string) {
  // 1. Let privEnv be the running execution context's PrivateEnvironment.
  const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 2. Assert: privEnv is not null.
  // but we allow private reference to be accessed directly in the inspector eval
  if (privEnv === null) {
    const scriptId = getActiveScriptId();
    const script = surroundingAgent.parsedSources.get(scriptId!);
    if (script instanceof DynamicParsedCodeRecord && script?.HostDefined?.isInspectorEval) {
      let privateName;
      if (baseValue instanceof ObjectValue) {
        privateName = baseValue.PrivateElements.find((elem) => elem.Key.Description === privateIdentifier)?.Key;
      }
      privateName ??= new PrivateName(privateIdentifier);
      return new ReferenceRecord({
        Base: baseValue,
        ReferencedName: privateName,
        Strict: true,
        ThisValue: undefined,
      });
    } else {
      Assert(privEnv !== null);
    }
  }
  // 3. Let privateName be ! ResolvePrivateIdentifier(privEnv, privateIdentifier).
  const privateName = ResolvePrivateIdentifier(privEnv!, privateIdentifier);
  // 4. Return the Reference Record { [[Base]]: baseValue, [[ReferencedName]]: privateName, [[Strict]]: true, [[ThisValue]]: empty }.
  return new ReferenceRecord({
    Base: baseValue,
    ReferencedName: privateName,
    Strict: true,
    ThisValue: undefined,
  });
}
