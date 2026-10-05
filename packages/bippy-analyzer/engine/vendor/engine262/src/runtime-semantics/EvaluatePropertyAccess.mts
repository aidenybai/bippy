import { Value, ReferenceRecord } from '../value.mts';
import { Evaluate, type ReferenceEvaluator } from '../evaluator.mts';
import { StringValue } from '../static-semantics/all.mts';
import { Q, type PlainCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  GetValue,
  Assert,
} from '#self';

/** https://tc39.es/ecma262/#sec-evaluate-expression-key-property-access */
export function* EvaluatePropertyAccessWithExpressionKey(baseValue: Value, expression: ParseNode.Expression, strict: boolean): ReferenceEvaluator {
  // 1. Let propertyNameReference be the result of evaluating expression.
  const propertyNameReference = Q(yield* Evaluate(expression));
  // 2. Let propertyNameValue be ? GetValue(propertyNameReference).
  const propertyNameValue = Q(yield* GetValue(propertyNameReference));
  // 3. Return the Reference Record { [[Base]]: bv, [[ReferencedName]]: propertyKey, [[Strict]]: strict, [[ThisValue]]: empty }.
  return new ReferenceRecord({
    Base: baseValue,
    ReferencedName: propertyNameValue,
    Strict: strict,
    ThisValue: undefined,
  });
}

/** https://tc39.es/ecma262/#sec-evaluate-identifier-key-property-access */
export function EvaluatePropertyAccessWithIdentifierKey(baseValue: Value, identifierName: ParseNode.IdentifierName, strict: boolean): PlainCompletion<ReferenceRecord> {
  // 1. Assert: identifierName is an IdentifierName.
  Assert(identifierName.type === 'IdentifierName');
  // 3. Let propertyNameString be StringValue of IdentifierName
  const propertyNameString = StringValue(identifierName);
  // 4. Return the Reference Record { [[Base]]: bv, [[ReferencedName]]: propertyNameString, [[Strict]]: strict, [[ThisValue]]: empty }.
  return new ReferenceRecord({
    Base: baseValue,
    ReferencedName: Value(propertyNameString),
    Strict: strict,
    ThisValue: undefined,
  });
}
