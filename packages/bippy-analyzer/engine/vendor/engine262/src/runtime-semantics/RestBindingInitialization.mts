import { Value } from '../value.mts';
import { StringValue } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  surroundingAgent,
  CopyDataProperties,
  InitializeReferencedBinding,
  OrdinaryObjectCreate,
  PutValue,
  ResolveBinding,
} from '#self';
import type { EnvironmentRecord, PropertyKeyValue } from '#self';

// BindingRestProperty : `...` BindingIdentifier
export function* RestBindingInitialization({ BindingIdentifier }: ParseNode.BindingRestProperty, value: Value, environment: EnvironmentRecord | undefined, excludedNames: readonly PropertyKeyValue[]) {
  // 1. Let lhs be ? ResolveBinding(StringValue of BindingIdentifier, environment).
  const lhs = Q(yield* ResolveBinding(StringValue(BindingIdentifier), BindingIdentifier.strict, environment));
  // 2. Let restObj be OrdinaryObjectCreate(%Object.prototype%).
  const restObj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  // 3. Perform ? CopyDataProperties(restObj, value, excludedNames).
  Q(yield* CopyDataProperties(restObj, value, excludedNames));
  // 4. If environment is undefined, return PutValue(lhs, restObj).
  if (!environment) {
    return yield* PutValue(lhs, restObj);
  }
  // 5. Return InitializeReferencedBinding(lhs, restObj).
  return yield* InitializeReferencedBinding(lhs, restObj);
}
