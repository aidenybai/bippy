import { Evaluate, type PlainEvaluator, type StatementEvaluator } from '../evaluator.mts';
import {
  ReferenceRecord, Value,
} from '../value.mts';
import {
  Completion,
  AbruptCompletion,
  NormalCompletion,
  EnsureCompletion,
  UpdateEmpty,
  Q,
} from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  BlockDeclarationInstantiation,
  Evaluate_StatementList,
} from './all.mts';
import {
  surroundingAgent,
  Assert, GetValue, IsStrictlyEqual, DeclarativeEnvironmentRecord,
  X,
} from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-caseclauseisselected */
function* CaseClauseIsSelected(constructor: ParseNode.CaseClause, input: Value): PlainEvaluator<boolean> {
  // 1. Assert: C is an instance of the production  CaseClause : `case` Expression `:` StatementList?.
  Assert(constructor.type === 'CaseClause');
  // 2. Let exprRef be the result of evaluating the Expression of C.
  const exprRef = Q(yield* Evaluate(constructor.Expression));
  // 3. Let clauseSelector be ? GetValue(exprRef).
  const clauseSelector = Q(yield* GetValue(exprRef));
  // 4. Return the result of performing Strict Equality Comparison input === clauseSelector.
  return IsStrictlyEqual(input, clauseSelector);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-caseblockevaluation */
//   CaseBlock :
//     `{` `}`
//     `{` CaseClauses `}`
//     `{` CaseClauses? DefaultClause CaseClauses? `}`
function* CaseBlockEvaluation(node: ParseNode.CaseBlock, input: Value): StatementEvaluator {
  const { CaseClauses_a, DefaultClause, CaseClauses_b } = node;
  switch (true) {
    case !CaseClauses_a && !DefaultClause && !CaseClauses_b: {
      // 1. Return NormalCompletion(undefined).
      return NormalCompletion(Value.undefined);
    }
    case !!CaseClauses_a && !DefaultClause && !CaseClauses_b: {
      // 1. Let V be undefined.
      let resultValue: Value = Value.undefined;
      // 2. Let A be the List of CaseClause items in CaseClauses, in source text order.
      const caseClauses = CaseClauses_a;
      // 3. Let found be false.
      let found = false;
      // 4. For each CaseClause C in A, do
      for (const clause of caseClauses) {
        // a. If found is false, then
        if (!found) {
          // i. Set found to ? CaseClauseIsSelected(C, input).
          found = Q(yield* CaseClauseIsSelected(clause, input));
        }
        // b. If found is true, them
        if (found) {
          // i. Let R be the result of evaluating C.
          const completion = EnsureCompletion(yield* Evaluate(clause));
          // ii. If R.[[Value]] is not empty, set V to R.[[Value]].
          if (completion.Value !== undefined) {
            resultValue = completion.Value;
          }
          // iii. If R is an abrupt completion, return Completion(UpdateEmpty(R, V)).
          if (completion instanceof AbruptCompletion) {
            return Completion(UpdateEmpty(completion, resultValue));
          }
        }
      }
      // 5. Return NormalCompletion(V).
      return NormalCompletion(resultValue);
    }
    case !!DefaultClause: {
      // 1. Let V be undefined.
      let resultValue: Value | ReferenceRecord = Value.undefined;
      // 2. If the first CaseClauses is present, then
      let caseClauses;
      if (CaseClauses_a) {
        // a. Let A be the List of CaseClause items in the first CaseClauses, in source text order.
        caseClauses = CaseClauses_a;
      } else { // 3. Else,
        // a. Let A be « ».
        caseClauses = [];
      }
      let found = false;
      // 4. For each CaseClause C in A, do
      for (const clause of caseClauses) {
        // a. If found is false, then
        if (!found) {
          // i. Set found to ? CaseClauseIsSelected(C, input).
          found = Q(yield* CaseClauseIsSelected(clause, input));
        }
        // b. If found is true, them
        if (found) {
          // i. Let R be the result of evaluating C.
          const completion = EnsureCompletion(yield* Evaluate(clause));
          // ii. If R.[[Value]] is not empty, set V to R.[[Value]].
          if (completion.Value !== undefined) {
            resultValue = completion.Value;
          }
          // iii. If R is an abrupt completion, return Completion(UpdateEmpty(R, V)).
          if (completion instanceof AbruptCompletion) {
            return Completion(UpdateEmpty(completion, resultValue));
          }
        }
      }
      // 6. Let foundInB be false.
      let foundInB = false;
      // 7. If the second CaseClauses is present, then
      let secondCaseClauses;
      if (CaseClauses_b) {
        // a. Let B be the List of CaseClause items in the second CaseClauses, in source text order.
        secondCaseClauses = CaseClauses_b;
      } else { // 8. Else,
        // a. Let B be « ».
        secondCaseClauses = [];
      }
      // 9. If found is false, then
      if (!found) {
        // a. For each CaseClause C in B, do
        for (const clause of secondCaseClauses) {
          // a. If foundInB is false, then
          if (!foundInB) {
            // i. Set foundInB to ? CaseClauseIsSelected(C, input).
            foundInB = Q(yield* CaseClauseIsSelected(clause, input));
          }
          // b. If foundInB is true, them
          if (foundInB) {
            // i. Let R be the result of evaluating C.
            const completion = EnsureCompletion(yield* Evaluate(clause));
            // ii. If R.[[Value]] is not empty, set V to R.[[Value]].
            if (completion.Value !== undefined) {
              resultValue = completion.Value;
            }
            // iii. If R is an abrupt completion, return Completion(UpdateEmpty(R, V)).
            if (completion instanceof AbruptCompletion) {
              return Completion(UpdateEmpty(completion, resultValue));
            }
          }
        }
      }
      // 10. If foundInB is true, return NormalCompletion(V).
      if (foundInB) {
        return NormalCompletion(resultValue as Value);
      }
      // 11. Let R be the result of evaluating DefaultClause.
      const completion = EnsureCompletion(yield* Evaluate(DefaultClause));
      // 12. If R.[[Value]] is not empty, set V to R.[[Value]].
      if (completion.Value !== undefined) {
        resultValue = completion.Value;
      }
      // 13. If R is an abrupt completion, return Completion(UpdateEmpty(R, V)).
      if (completion instanceof AbruptCompletion) {
        return Completion(UpdateEmpty(completion, resultValue));
      }
      // 14. NOTE: The following is another complete iteration of the second CaseClauses.
      // 15. For each CaseClause C in B, do
      for (const clause of secondCaseClauses) {
        // a. Let R be the result of evaluating CaseClause C.
        const innerR = EnsureCompletion(yield* Evaluate(clause));
        // b. If R.[[Value]] is not empty, set V to R.[[Value]].
        if (innerR.Value !== undefined) {
          resultValue = innerR.Value;
        }
        // c. If R is an abrupt completion, return Completion(UpdateEmpty(R, V)).
        if (innerR instanceof AbruptCompletion) {
          return Completion(UpdateEmpty(innerR, resultValue));
        }
      }
      // 16. Return NormalCompletion(V).
      //
      return NormalCompletion(resultValue as Value);
    }
    default:
      throw OutOfRange.nonExhaustive(node);
  }
}

/** https://tc39.es/ecma262/#sec-switch-statement-runtime-semantics-evaluation */
//   SwitchStatement :
//     `switch` `(` Expression `)` CaseBlock
export function* Evaluate_SwitchStatement({ Expression, CaseBlock }: ParseNode.SwitchStatement): StatementEvaluator {
  const exprRef = Q(yield* Evaluate(Expression));
  const switchValue = Q(yield* GetValue(exprRef));
  const oldEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const blockEnv = new DeclarativeEnvironmentRecord(oldEnv);
  X(BlockDeclarationInstantiation(CaseBlock, blockEnv));
  surroundingAgent.runningExecutionContext.LexicalEnvironment = blockEnv;
  const blockResult = yield* CaseBlockEvaluation(CaseBlock, switchValue);
  Assert(blockEnv.DisposableResourceStack.length === 0);
  surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
  return blockResult;
}

/** https://tc39.es/ecma262/#sec-switch-statement-runtime-semantics-evaluation */
//   CaseClause :
//     `case` Expression `:`
//     `case` Expression `:` StatementList
//   DefaultClause :
//     `case` `default` `:`
//     `case` `default` `:` StatementList
export function* Evaluate_CaseClause({ StatementList }: ParseNode.CaseClause | ParseNode.DefaultClause) {
  if (!StatementList) {
    return NormalCompletion(undefined);
  }
  return yield* Evaluate_StatementList(StatementList);
}
