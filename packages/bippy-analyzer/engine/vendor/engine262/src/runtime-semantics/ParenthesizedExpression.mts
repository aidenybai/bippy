import { Evaluate } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-grouping-operator-runtime-semantics-evaluation */
export function* Evaluate_ParenthesizedExpression({ Expression }: ParseNode.ParenthesizedExpression) {
  // 1. Return the result of evaluating Expression. This may be of type Reference.
  return yield* Evaluate(Expression);
}
