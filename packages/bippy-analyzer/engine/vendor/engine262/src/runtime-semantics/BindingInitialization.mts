import { Value } from '../value.mts';
import {
  EnsureCompletion,
  EnvironmentRecord, StringValue,
} from '../index.mts';
import { NormalCompletion, Q } from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import {
  IteratorBindingInitialization_ArrayBindingPattern,
  PropertyBindingInitialization,
  RestBindingInitialization,
} from './all.mts';
import {
  Assert,
  PutValue,
  ResolveBinding,
  RequireObjectCoercible,
  GetIterator,
  IteratorClose,
} from '#self';

/** https://tc39.es/ecma262/#sec-initializeboundname */
export function* InitializeBoundName(name: string, value: Value, environment: EnvironmentRecord | undefined): PlainEvaluator {
  // 1. Assert: Type(name) is String.
  Assert(typeof name === 'string');
  // 2. If environment is not undefined, then
  if (environment !== undefined) {
    // a. Perform environment.InitializeBinding(name, value).
    yield* environment.InitializeBinding(name, value);
    // b. Return NormalCompletion(undefined).
    return NormalCompletion(undefined);
  } else {
    // a. Let lhs be ResolveBinding(name).
    const lhs = Q(yield* ResolveBinding(name, false));
    // b. Return ? PutValue(lhs, value).
    return Q(yield* PutValue(lhs, value));
  }
}

// ObjectBindingPattern :
//   `{` `}`
//   `{` BindingPropertyList `}`
//   `{` BindingRestProperty `}`
//   `{` BindingPropertyList `,` BindingRestProperty `}`
function* BindingInitialization_ObjectBindingPattern({ BindingPropertyList, BindingRestProperty }: ParseNode.ObjectBindingPattern, value: Value, environment: EnvironmentRecord | undefined): PlainEvaluator {
  // 1. Perform ? PropertyBindingInitialization for BindingPropertyList using value and environment as the arguments.
  const excludedNames = Q(yield* PropertyBindingInitialization(BindingPropertyList, value, environment));
  if (BindingRestProperty) {
    Q(yield* RestBindingInitialization(BindingRestProperty, value, environment, excludedNames));
  }
  // 2. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}

export function* BindingInitialization(node: ParseNode.ForBinding | ParseNode.BindingIdentifier | ParseNode.ObjectBindingPattern | ParseNode.ArrayBindingPattern | ParseNode.BindingPattern, value: Value, environment: EnvironmentRecord | undefined): PlainEvaluator {
  switch (node.type) {
    case 'ForBinding':
      if (node.BindingIdentifier) {
        return yield* BindingInitialization(node.BindingIdentifier, value, environment);
      }
      return yield* BindingInitialization(node.BindingPattern!, value, environment);
    case 'BindingIdentifier': {
      // 1. Let name be StringValue of Identifier.
      const name = StringValue(node);
      // 2. Return ? InitializeBoundName(name, value, environment).
      return Q(yield* InitializeBoundName(name, value, environment));
    }
    case 'ObjectBindingPattern': {
      // 1. Perform ? RequireObjectCoercible(value).
      Q(RequireObjectCoercible(value));
      // 2. Return the result of performing BindingInitialization for ObjectBindingPattern using value and environment as arguments.
      return yield* BindingInitialization_ObjectBindingPattern(node, value, environment);
    }
    case 'ArrayBindingPattern': {
      // 1. Let iteratorRecord be ? GetIterator(value).
      const iteratorRecord = Q(yield* GetIterator(value, 'sync'));
      // 2. Let result be IteratorBindingInitialization of ArrayBindingPattern with arguments iteratorRecord and environment.
      const result = EnsureCompletion(yield* IteratorBindingInitialization_ArrayBindingPattern(node, iteratorRecord, environment));
      // 3. If iteratorRecord.[[Done]] is false, return ? IteratorClose(iteratorRecord, result).
      if (!iteratorRecord.Done) {
        return Q(yield* IteratorClose(iteratorRecord, result));
      }
      // 4. Return ? result.
      return result;
    }
    default:
      throw OutOfRange.exhaustive(node);
  }
}
