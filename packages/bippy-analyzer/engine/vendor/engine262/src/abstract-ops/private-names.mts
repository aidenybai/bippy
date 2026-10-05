import { ObjectValue, PrivateName, Value } from '../value.mts';
import { Q, X } from '../completion.mts';
import { ClassElementDefinitionRecord, PrivateElementRecord } from '../runtime-semantics/all.mts';
import {
  Assert, Call, IsExtensible,
} from './all.mts';
import { Throw, type PlainEvaluator } from '#self';

/** https://tc39.es/ecma262/#sec-privateelementfind */
export function PrivateElementFind(P: PrivateName, O: ObjectValue) {
  const entry = O.PrivateElements.find((e) => e.Key === P);
  // 1. If O.[[PrivateElements]] contains a PrivateElement whose [[Key]] is P, then
  if (entry) {
    // a. Let entry be that PrivateElement.
    // b. Return entry.
    return entry;
  }
  // 2. Return empty.
  return undefined;
}

/** https://tc39.es/ecma262/#sec-privateget */
export function* PrivateGet(O: ObjectValue, P: PrivateName) {
  // 1. Let entry be ! PrivateElementFind(P, O).
  const entry = X(PrivateElementFind(P, O));
  // 2. If entry is empty, throw a TypeError exception.
  if (entry === undefined) {
    return Throw.TypeError('$1 does not exist on $2', P, O);
  }
  // 3. If entry.[[Kind]] is field or method, then
  if (entry.Kind === 'field' || entry.Kind === 'method') {
    // a. Return entry.[[Value]].
    return entry.Value!;
  }
  // 4. Assert: entry.[[Kind]] is accessor.
  Assert(entry.Kind === 'accessor');
  // 5. If entry.[[Get]] is undefined, throw a TypeError exception.
  if (entry.Get === Value.undefined) {
    return Throw.TypeError('Private field $1 is not a getter', P);
  }
  // 6. Let getter be entry.[[Get]].
  const getter = entry.Get!;
  // 7. Return ? Call(getter, O).
  return Q(yield* Call(getter, O));
}

export function* PrivateSet(O: ObjectValue, P: PrivateName, value: Value) {
  // 1. Let entry be ! PrivateElementFind(P, O).
  const entry = X(PrivateElementFind(P, O));
  // 2. If entry is empty, throw a TypeError exception.
  if (entry === undefined) {
    return Throw.TypeError('$1 does not exist on $2', P, O);
  }
  // 3. If entry.[[Kind]] is field, then
  if (entry.Kind === 'field') {
    // a. Set entry.[[Value]] to value.
    entry.Value = value;
  } else if (entry.Kind === 'method') { // 4. Else if entry.[[Kind]] is method, then
    // a. Throw a TypeError exception.
    return Throw.TypeError('Private method $1 cannot be set', P);
  } else { // 5. Else,
    // a. Assert: entry.[[Kind]] is accessor.
    Assert(entry.Kind === 'accessor');
    // b. If entry.[[Set]] is undefined, throw a TypeError exception.
    if (entry.Set === Value.undefined) {
      return Throw.TypeError('Private field $1 is not a setter', P);
    }
    // c. Let setter be entry.[[Set]].
    const setter = entry.Set!;
    // d. Perform ? Call(setter, O, « value »).
    Q(yield* Call(setter, O, [value]));
  }
  return undefined;
}

/** https://tc39.es/ecma262/#sec-privatemethodoraccessoradd */
export function* PrivateMethodOrAccessorAdd(O: ObjectValue, method: PrivateElementRecord) {
  // 1. Assert: method.[[Kind]] is either method or accessor.
  Assert(method.Kind === 'method' || method.Kind === 'accessor');
  if (!Q(yield* IsExtensible(O))) {
    return Throw.TypeError('Cannot define private element to a non-extensible object');
  }
  // 2. Let entry be ! PrivateElementFind(method.[[Key]], O).
  const entry = X(PrivateElementFind(method.Key, O));
  // 3. If entry is not empty, throw a TypeError exception.
  if (entry !== undefined) {
    return Throw.TypeError('Private element $1 is already defined on $2', method.Key, O);
  }
  // 4. Append method to O.[[PrivateElements]].
  O.PrivateElements.push(method);
  // 5. NOTE: The values for private methods and accessors are shared across instances.
  //          This step does not create a new copy of the method or accessor.
  return undefined;
}

/** https://tc39.es/ecma262/#sec-privatefieldadd */
export function* PrivateFieldAdd(O: ObjectValue, P: PrivateName, value: Value) {
  // 1. Let entry be ! PrivateElementFind(P, O).
  const entry = X(PrivateElementFind(P, O));
  if (!Q(yield* IsExtensible(O))) {
    return Throw.TypeError('Cannot define private element to a non-extensible object');
  }
  // 2. If entry is not empty, throw a TypeError exception.
  if (entry !== undefined) {
    return Throw.TypeError('Private element $1 is already defined on $2', P, O);
  }
  // 3. Append PrivateElement { [[Key]]: P, [[Kind]]: field, [[Value]]: value } to O.[[PrivateElements]].
  O.PrivateElements.push(PrivateElementRecord({
    Key: P,
    Kind: 'field',
    Value: value,
  }));
  return undefined;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-initializeprivatemethods */
export function* InitializePrivateMethods(O: ObjectValue, elementDefinitions: readonly ClassElementDefinitionRecord[]): PlainEvaluator<void> {
  const privateMethods: PrivateElementRecord[] = [];
  for (const element of elementDefinitions) {
    if (element.Key instanceof PrivateName && (element.Kind === 'method' || element.Kind === 'getter' || element.Kind === 'setter' || element.Kind === 'accessor')) {
      if (element.Kind === 'method') {
        const privateElement = PrivateElementRecord({
          Key: element.Key,
          Kind: 'method',
          Value: element.Value,
        });
        privateMethods.push(privateElement);
      } else if (element.Kind === 'accessor') {
        const privateElement = PrivateElementRecord({
          Key: element.Key,
          Kind: 'accessor',
          Get: element.Get,
          Set: element.Set,
        });
        privateMethods.push(privateElement);
      } else {
        Assert(element.Kind === 'getter' || element.Kind === 'setter');
        let getter = element.Kind === 'getter' ? element.Get : Value.undefined;
        let setter = element.Kind === 'setter' ? element.Set : Value.undefined;
        let existing: PrivateElementRecord | undefined;
        const e = privateMethods.find(((e) => e.Key === element.Key));
        if (e) {
          Assert(e.Kind === 'accessor');
          existing = e;
          if (e.Get !== undefined && e.Get !== Value.undefined) {
            getter = e.Get;
          }
          if (e.Set !== undefined && e.Set !== Value.undefined) {
            setter = e.Set;
          }
        }
        const privateElement = PrivateElementRecord({
          Key: element.Key,
          Kind: 'accessor',
          Get: getter,
          Set: setter,
        });
        if (existing) {
          const index = privateMethods.indexOf(existing);
          privateMethods[index] = privateElement;
        } else {
          privateMethods.push(privateElement);
        }
      }
    }
  }
  for (const method of privateMethods) {
    Q(yield* PrivateMethodOrAccessorAdd(O, method));
  }
}
