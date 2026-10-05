import { Value } from '../value.mts';
import { Evaluate } from '../evaluator.mts';
import { StringValue, IsAnonymousFunctionDefinition } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  NamedEvaluation,
  BindingInitialization,
} from './all.mts';
import {
  GetV,
  GetValue,
  PutValue,
  ResolveBinding,
  InitializeReferencedBinding,
} from '#self';
import type {
  EnvironmentRecord, FunctionDeclaration, PropertyKeyValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-keyedbindinginitialization */
export function* KeyedBindingInitialization(node: ParseNode.BindingElement | ParseNode.SingleNameBinding, value: Value, environment: EnvironmentRecord | undefined, propertyName: string | PropertyKeyValue) {
  if (node.type === 'BindingElement') {
    // 1. Let v be ? GetV(value, propertyName).
    let v = Q(yield* GetV(value, propertyName));
    // 2. If Initializer is present and v is undefined, then
    if (node.Initializer && v === Value.undefined) {
      // a. Let defaultValue be the result of evaluating Initializer.
      const defaultValue = Q(yield* Evaluate(node.Initializer));
      // b. Set v to ? GetValue(defaultValue).
      v = Q(yield* GetValue(defaultValue));
    }
    // 2. Return the result of performing BindingInitialization for BindingPattern passing v and environment as arguments.
    return yield* BindingInitialization(node.BindingPattern, v, environment);
  } else {
    // 1. Let bindingId be StringValue of BindingIdentifier.
    const bindingId = StringValue(node.BindingIdentifier);
    // 2. Let lhs be ? ResolveBinding(bindingId, environment).
    const lhs = Q(yield* ResolveBinding(bindingId, node.BindingIdentifier.strict, environment));
    // 3. Let v be ? GetV(value, propertyName).
    let v = Q(yield* GetV(value, propertyName));
    if (node.Initializer && v === Value.undefined) {
      // a. If IsAnonymousFunctionDefinition(Initializer) is true, then
      if (IsAnonymousFunctionDefinition(node.Initializer)) {
        // i. Set v to the result of performing NamedEvaluation for Initializer with argument bindingId.
        v = (yield* NamedEvaluation(node.Initializer as FunctionDeclaration, bindingId)) as Value;
      } else { // b. Else,
        // i. Let defaultValue be the result of evaluating Initializer.
        const defaultValue = Q(yield* Evaluate(node.Initializer));
        // ii. Set v to ? GetValue(defaultValue).
        v = Q(yield* GetValue(defaultValue));
      }
    }
    // 5. If environment is undefined, return ? PutValue(lhs, v).
    if (!environment) {
      return Q(yield* PutValue(lhs, v));
    }
    // 6. Return InitializeReferencedBinding(lhs, v).
    return yield* InitializeReferencedBinding(lhs, v);
  }
}
