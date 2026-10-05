import { Evaluate } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  EvaluatePropertyAccessWithExpressionKey,
  EvaluatePropertyAccessWithIdentifierKey,
} from './all.mts';
import { GetValue, MakePrivateReference } from '#self';
import type { PlainEvaluator, ReferenceRecord } from '#self';

/** https://tc39.es/ecma262/#sec-property-accessors-runtime-semantics-evaluation */
//   MemberExpression : MemberExpression `[` Expression `]`
//   CallExpression : CallExpression `[` Expression `]`
function* Evaluate_MemberExpression_Expression({ strict, MemberExpression, Expression }: ParseNode.MemberExpression): PlainEvaluator<ReferenceRecord> {
  // 1. Let baseReference be the result of evaluating |MemberExpression|.
  const baseReference = Q(yield* Evaluate(MemberExpression));
  // 2. Let baseValue be ? GetValue(baseReference).
  const baseValue = Q(yield* GetValue(baseReference));
  // 3. If the code matched by this |MemberExpression| is strict mode code, let strict be true; else let strict be false.
  // 4. Return ? EvaluatePropertyAccessWithExpressionKey(baseValue, |Expression|, strict).
  return Q(yield* EvaluatePropertyAccessWithExpressionKey(baseValue, Expression!, strict));
}

/** https://tc39.es/ecma262/#sec-property-accessors-runtime-semantics-evaluation */
//   MemberExpression : MemberExpression `.` IdentifierName
//   CallExpression : CallExpression `.` IdentifierName
function* Evaluate_MemberExpression_IdentifierName({ strict, MemberExpression, IdentifierName }: ParseNode.MemberExpression): PlainEvaluator<ReferenceRecord> {
  // 1. Let baseReference be the result of evaluating |MemberExpression|.
  const baseReference = Q(yield* Evaluate(MemberExpression));
  // 2. Let baseValue be ? GetValue(baseReference).
  const baseValue = Q(yield* GetValue(baseReference));
  // 3. If the code matched by this |MemberExpression| is strict mode code, let strict be true; else let strict be false.
  // 4. Return ! EvaluatePropertyAccessWithIdentifierKey(baseValue, |IdentifierName|, strict).
  return X(EvaluatePropertyAccessWithIdentifierKey(baseValue, IdentifierName!, strict));
}

/** https://tc39.es/ecma262/#sec-property-accessors-runtime-semantics-evaluation */
//   MemberExpression : MemberExpression `.` PrivateIdentifier
//   CallExpression : CallExpression `.` PrivateIdentifier
function* Evaluate_MemberExpression_PrivateIdentifier({ MemberExpression, PrivateIdentifier }: ParseNode.MemberExpression): PlainEvaluator<ReferenceRecord> {
  // 1. Let baseReference be the result of evaluating MemberExpression.
  const baseReference = Q(yield* Evaluate(MemberExpression));
  // 2. Let baseValue be ? GetValue(baseReference).
  const baseValue = Q(yield* GetValue(baseReference));
  // 3. Let fieldNameString be the StringValue of PrivateIdentifier.
  const fieldNameString = StringValue(PrivateIdentifier!);
  // 4. Return ! MakePrivateReference(bv, fieldNameString).
  return X(MakePrivateReference(baseValue, fieldNameString));
}

/** https://tc39.es/ecma262/#sec-property-accessors-runtime-semantics-evaluation */
//   MemberExpression :
//     MemberExpression `[` Expression `]`
//     MemberExpression `.` IdentifierName
//   CallExpression :
//     CallExpression `[` Expression `]`
//     CallExpression `.` IdentifierName
export function Evaluate_MemberExpression(MemberExpression: ParseNode.MemberExpression) {
  switch (true) {
    case !!MemberExpression.Expression:
      return Evaluate_MemberExpression_Expression(MemberExpression);
    case !!MemberExpression.IdentifierName:
      return Evaluate_MemberExpression_IdentifierName(MemberExpression);
    case !!MemberExpression.PrivateIdentifier:
      return Evaluate_MemberExpression_PrivateIdentifier(MemberExpression);
    default:
      throw OutOfRange.nonExhaustive(MemberExpression);
  }
}
