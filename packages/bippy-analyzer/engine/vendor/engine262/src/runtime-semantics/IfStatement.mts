import { Evaluate } from '../evaluator.mts';
import {
  Completion,
  EnsureCompletion,
  NormalCompletion,
  Q,
  UpdateEmpty,
} from '../completion.mts';
import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  GetValue,
  ToBoolean,
} from '#self';

/** https://tc39.es/ecma262/#sec-if-statement-runtime-semantics-evaluation */
// IfStatement :
//   `if` `(` Expression `)` Statement `else` Statement
//   `if` `(` Expression `)` Statement
export function* Evaluate_IfStatement({ Expression, Statement_a, Statement_b }: ParseNode.IfStatement) {
  // 1. Let exprRef be the result of evaluating Expression.
  const exprRef = Q(yield* Evaluate(Expression));
  // 2. Let exprValue be ! ToBoolean(? GetValue(exprRef)).
  const exprValue = ToBoolean(Q(yield* GetValue(exprRef)));
  if (Statement_b) {
    let stmtCompletion;
    // 3. If exprValue is true, then
    if (exprValue) {
      // a. Let stmtCompletion be the result of evaluating the first Statement.
      stmtCompletion = yield* Evaluate(Statement_a);
    } else { // 4. Else,
      // a. Let stmtCompletion be the result of evaluating the second Statement.
      stmtCompletion = yield* Evaluate(Statement_b);
    }
    // 5. Return Completion(UpdateEmpty(stmtCompletion, undefined)).
    return Completion(UpdateEmpty(EnsureCompletion(stmtCompletion), Value.undefined));
  } else {
    // 3. If exprValue is false, then
    if (!exprValue) {
      // a. Return NormalCompletion(undefined).
      return NormalCompletion(Value.undefined);
    } else { // 4. Else,
      // a. Let stmtCompletion be the result of evaluating Statement.
      const stmtCompletion = yield* Evaluate(Statement_a);
      // b. Return Completion(UpdateEmpty(stmtCompletion, undefined)).
      return Completion(UpdateEmpty(EnsureCompletion(stmtCompletion), Value.undefined));
    }
  }
}
