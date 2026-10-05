import { ReferenceRecord, Value } from '../value.mts';
import { Evaluate, type ExpressionEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import { IsInTailPosition, StringValue } from '../static-semantics/all.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  EvaluateCall,
  EvaluatePropertyAccessWithExpressionKey,
  EvaluatePropertyAccessWithIdentifierKey,
} from './all.mts';
import { GetValue, MakePrivateReference } from '#self';

/** https://tc39.es/ecma262/#sec-optional-chaining-evaluation */
//   OptionalExpression :
//     MemberExpression OptionalChain
//     CallExpression OptionalChain
//     OptionalExpression OptionalChain
export function* Evaluate_OptionalExpression(node: ParseNode.OptionalExpression) {
  const { MemberExpression, OptionalChain } = node;
  // 1. Let baseReference be the result of evaluating MemberExpression.
  const baseReference = Q(yield* Evaluate(MemberExpression));
  // 2. Let baseValue be ? GetValue(baseReference).
  const baseValue = Q(yield* GetValue(baseReference));
  // 3. If baseValue is undefined or null, then
  if (baseValue === Value.undefined || baseValue === Value.null) {
    // a. Return undefined.
    return Value.undefined;
  }
  // 4. Return the result of performing ChainEvaluation of OptionalChain with arguments baseValue and baseReference.
  return yield* ChainEvaluation(OptionalChain, baseValue, X(baseReference), node);
}

/** https://tc39.es/ecma262/#sec-optional-chaining-chain-evaluation */
//   OptionalChain :
//     `?.` Arguments
//     `?.` `[` Expression `]`
//     `?.` IdentifierName
//     `?.` PrivateIdentifier
//     OptionalChain Arguments
//     OptionalChain `[` Expression `]`
//     OptionalChain `.` IdentifierName
//     OptionalChain `.` PrivateIdentifier
function* ChainEvaluation(node: ParseNode.OptionalChain, baseValue: Value, baseReference: Value | ReferenceRecord, topExpression?: ParseNode.OptionalExpression): ExpressionEvaluator {
  const {
    OptionalChain,
    Arguments,
    Expression,
    IdentifierName,
    PrivateIdentifier,
  } = node;
  if (Arguments) {
    if (OptionalChain) {
      // 1. Let optionalChain be OptionalChain.
      const optionalChain = OptionalChain;
      // 2. Let newReference be ? ChainEvaluation of optionalChain with arguments baseValue and baseReference.
      const newReference = Q(yield* ChainEvaluation(optionalChain, baseValue, baseReference, topExpression));
      // 3. Let newValue be ? GetValue(newReference).
      const newValue = Q(yield* GetValue(newReference));
      // 4. Let thisChain be this OptionalChain.
      const thisChain = node;
      // 5. Let tailCall be IsInTailPosition(thisChain).
      const tailCall = IsInTailPosition(thisChain);
      // 6. Return ? EvaluateCall(newValue, newReference, Arguments, tailCall).
      return Q(yield* EvaluateCall(newValue, newReference, Arguments, tailCall, topExpression));
    }
    // 1. Let thisChain be this OptionalChain.
    const thisChain = node;
    // 2. Let tailCall be IsInTailPosition(thisChain).
    const tailCall = IsInTailPosition(thisChain);
    // 3. Return ? EvaluateCall(baseValue, baseReference, Arguments, tailCall).
    return Q(yield* EvaluateCall(baseValue, baseReference, Arguments, tailCall, topExpression));
  }
  if (Expression) {
    if (OptionalChain) {
      // 1. Let optionalChain be OptionalChain.
      const optionalChain = OptionalChain;
      // 2. Let newReference be ? ChainEvaluation of optionalChain with arguments baseValue and baseReference.
      const newReference = Q(yield* ChainEvaluation(optionalChain, baseValue, baseReference, topExpression));
      // 3. Let newValue be ? GetValue(newReference).
      const newValue = Q(yield* GetValue(newReference));
      // 4. If the code matched by this OptionalChain is strict mode code, let strict be true; else let strict be false.
      const strict = node.strict;
      // 5. Return ? EvaluatePropertyAccessWithExpressionKey(newValue, Expression, strict).
      return Q(yield* EvaluatePropertyAccessWithExpressionKey(newValue, Expression, strict));
    }
    // 1. If the code matched by this OptionalChain is strict mode code, let strict be true; else let strict be false.
    const strict = node.strict;
    // 2. Return ? EvaluatePropertyAccessWithExpressionKey(baseValue, Expression, strict).
    return Q(yield* EvaluatePropertyAccessWithExpressionKey(baseValue, Expression, strict));
  }
  if (IdentifierName) {
    if (OptionalChain) {
      // 1. Let optionalChain be OptionalChain.
      const optionalChain = OptionalChain;
      // 2. Let newReference be ? ChainEvaluation of optionalChain with arguments baseValue and baseReference.
      const newReference = Q(yield* ChainEvaluation(optionalChain, baseValue, baseReference, topExpression));
      // 3. Let newValue be ? GetValue(newReference).
      const newValue = Q(yield* GetValue(newReference));
      // 4. If the code matched by this OptionalChain is strict mode code, let strict be true; else let strict be false.
      const strict = node.strict;
      // 5. Return ! EvaluatePropertyAccessWithIdentifierKey(newValue, IdentifierName, strict).
      return X(EvaluatePropertyAccessWithIdentifierKey(newValue, IdentifierName, strict));
    }
    // 1. If the code matched by this OptionalChain is strict mode code, let strict be true; else let strict be false.
    const strict = node.strict;
    // 2. Return ! EvaluatePropertyAccessWithIdentifierKey(baseValue, IdentifierName, strict).
    return X(EvaluatePropertyAccessWithIdentifierKey(baseValue, IdentifierName, strict));
  }
  if (PrivateIdentifier) {
    if (OptionalChain) {
      // 1. Let optionalChain be OptionalChain.
      const optionalChain = OptionalChain;
      // 2. Let newReference be ? ChainEvaluation of optionalChain with arguments baseValue and baseReference.
      const newReference = Q(yield* ChainEvaluation(optionalChain, baseValue, baseReference, topExpression));
      // 3. Let newValue be ? GetValue(newReference).
      const newValue = Q(yield* GetValue(newReference));
      // 4. Let fieldNameString be the StringValue of PrivateIdentifier.
      const fieldNameString = StringValue(PrivateIdentifier);
      // 5. Return ! MakePrivateReference(nv, fieldNameString).
      return X(MakePrivateReference(newValue, fieldNameString));
    }
    // 1. Let fieldNameString be the StringValue of PrivateIdentifier.
    const fieldNameString = StringValue(PrivateIdentifier);
    // 2. Return ! MakePrivateReference(bv, fieldNameString).
    return X(MakePrivateReference(baseValue, fieldNameString));
  }
  throw OutOfRange.nonExhaustive(node);
}
