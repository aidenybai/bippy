import { Value } from '../value.mts';
import { Evaluate } from '../evaluator.mts';
import { StringValue, NumericValue } from '../static-semantics/all.mts';
import { Q, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  surroundingAgent,
  Assert,
  ToString,
  GetValue,
  ToPropertyKey,
} from '#self';
import type {
  PlainEvaluator, PrivateEnvironmentRecord, PrivateName, PropertyKeyValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-object-initializer-runtime-semantics-evaluation */
// PropertyName :
//   LiteralPropertyName
//   ComputedPropertyName
// LiteralPropertyName :
//   IdentifierName
//   StringLiteral
//   NumericLiteral
// ComputedPropertyName :
//   `[` AssignmentExpression `]`
export function* Evaluate_PropertyName(PropertyName: ParseNode.PropertyNameLike | ParseNode.PrivateIdentifier): PlainEvaluator<PropertyKeyValue | PrivateName> {
  switch (PropertyName.type) {
    case 'IdentifierName':
      return Value(StringValue(PropertyName));
    case 'StringLiteral':
      return Value(PropertyName.value);
    case 'NumericLiteral': {
      // 1. Let nbr be the NumericValue of NumericLiteral.
      const nbr = NumericValue(PropertyName);
      // 2. Return ! ToString(nbr).
      return Value(X(ToString(Value(nbr))));
    }
    case 'PrivateIdentifier': {
      // 1. Let privateIdentifier be StringValue of PrivateIdentifier.
      const privateIdentifier = StringValue(PropertyName);
      // 2. Let privateEnvRec be the running execution context's PrivateEnvironment.
      const privateEnvRec = surroundingAgent.runningExecutionContext.PrivateEnvironment;
      // 3. Let names be privateEnvRec.[[Names]].
      const names = (privateEnvRec as PrivateEnvironmentRecord).Names;
      // 4. Assert: Exactly one element of names is a Private Name whose [[Description]] is privateIdentifier.
      // 5. Let privateName be the Private Name in names whose [[Description]] is privateIdentifier.
      const privateName = names.find((n) => n.Description === privateIdentifier);
      Assert(!!privateName);
      // 6. Return privateName.
      return privateName;
    }
    default: {
      // 1. Let exprValue be the result of evaluating AssignmentExpression.
      const exprValue = Q(yield* Evaluate(PropertyName.ComputedPropertyName));
      // 2. Let propName be ? GetValue(exprValue).
      const propName = Q(yield* GetValue(exprValue));
      // 3. Return ? ToPropertyKey(propName).
      return Q(yield* ToPropertyKey(propName));
    }
  }
}
