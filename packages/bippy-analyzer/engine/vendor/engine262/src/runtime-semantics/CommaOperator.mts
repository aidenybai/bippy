import { Evaluate } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetValue } from '#self';
import type { Value, ValueEvaluator } from '#self';

/** https://tc39.es/ecma262/#sec-comma-operator-runtime-semantics-evaluation */
//   Expression :
//     AssignmentExpression
//     Expression `,` AssignmentExpression
export function* Evaluate_CommaOperator({ ExpressionList }: ParseNode.CommaOperator): ValueEvaluator {
  let result!: Value;
  for (const Expression of ExpressionList) {
    const lref = Q(yield* Evaluate(Expression));
    result = Q(yield* GetValue(lref));
  }
  return result;
}
