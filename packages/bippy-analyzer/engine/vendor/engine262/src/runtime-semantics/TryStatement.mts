import { Value } from '../value.mts';
import { Evaluate, type StatementEvaluator } from '../evaluator.mts';
import {
  Completion,
  AbruptCompletion,
  UpdateEmpty,
  EnsureCompletion,
  X,
} from '../completion.mts';
import { BoundNames } from '../static-semantics/all.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { BindingInitialization } from './all.mts';
import { surroundingAgent, DeclarativeEnvironmentRecord } from '#self';

/** https://tc39.es/ecma262/#sec-try-statement-runtime-semantics-evaluation */
//   TryStatement :
//     `try` Block Catch
//     `try` Block Finally
//     `try` Block Catch Finally
export function Evaluate_TryStatement(TryStatement: ParseNode.TryStatement) {
  switch (true) {
    case !!TryStatement.Catch && !TryStatement.Finally:
      return Evaluate_TryStatement_BlockCatch(TryStatement);
    case !TryStatement.Catch && !!TryStatement.Finally:
      return Evaluate_TryStatement_BlockFinally(TryStatement);
    case !!TryStatement.Catch && !!TryStatement.Finally:
      return Evaluate_TryStatement_BlockCatchFinally(TryStatement);
    default:
      throw OutOfRange.nonExhaustive(TryStatement);
  }
}

// TryStatement : `try` Block Catch
function* Evaluate_TryStatement_BlockCatch({ Block, Catch }: ParseNode.TryStatement) {
  // 1. Let B be the result of evaluating Block.
  const blockResult = EnsureCompletion(yield* Evaluate(Block));
  // 2. If B.[[Type]] is throw, let C be CatchClauseEvaluation of Catch with argument B.[[Value]].
  let catchResult;
  if (blockResult.Type === 'throw') {
    catchResult = EnsureCompletion(yield* CatchClauseEvaluation(Catch!, blockResult.Value));
  } else { // 3. Else, let C be B.
    catchResult = blockResult;
  }
  // 3. Return Completion(UpdateEmpty(C, undefined)).
  return Completion(UpdateEmpty(catchResult, Value.undefined));
}

// TryStatement : `try` Block Finally
function* Evaluate_TryStatement_BlockFinally({ Block, Finally }: ParseNode.TryStatement) {
  // 1. Let B be the result of evaluating Block.
  const blockResult = EnsureCompletion(yield* Evaluate(Block));
  // 1. Let F be the result of evaluating Finally.
  let finallyResult = EnsureCompletion(yield* Evaluate(Finally!));
  // 1. If F.[[Type]] is normal, set F to B.
  if (finallyResult.Type === 'normal') {
    finallyResult = blockResult;
  }
  // 1. Return Completion(UpdateEmpty(F, undefined)).
  return Completion(UpdateEmpty(finallyResult, Value.undefined));
}

// TryStatement : `try` Block Catch Finally
function* Evaluate_TryStatement_BlockCatchFinally({ Block, Catch, Finally }: ParseNode.TryStatement) {
  // 1. Let B be the result of evaluating Block.
  const blockResult = EnsureCompletion(yield* Evaluate(Block));
  // 2. If B.[[Type]] is throw, let C be CatchClauseEvaluation of Catch with argument B.[[Value]].
  let catchResult: Completion<Value | void>;
  if (blockResult.Type === 'throw') {
    catchResult = EnsureCompletion(yield* CatchClauseEvaluation(Catch!, blockResult.Value));
  } else { // 3. Else, let C be B.
    catchResult = blockResult;
  }
  // 4. Let F be the result of evaluating Finally.
  let finallyResult = EnsureCompletion(yield* Evaluate(Finally!));
  // 5. If F.[[Type]] is normal, set F to C.
  if (finallyResult.Type === 'normal') {
    finallyResult = catchResult;
  }
  // 6. Return Completion(UpdateEmpty(F, undefined)).
  return Completion(UpdateEmpty(finallyResult, Value.undefined));
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-catchclauseevaluation */
//  Catch :
//    `catch` Block
//    `catch` `(` CatchParameter `)` Block
function* CatchClauseEvaluation({ CatchParameter, Block }: ParseNode.Catch, thrownValue: Value): StatementEvaluator {
  if (!CatchParameter) {
    // 1. Return the result of evaluating Block.
    return yield* Evaluate(Block);
  }
  // 1. Let oldEnv be the running execution context's LexicalEnvironment.
  const oldEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 2. Let catchEnv be NewDeclarativeEnvironment(oldEnv).
  const catchEnv = new DeclarativeEnvironmentRecord(oldEnv);
  // 3. For each element argName of the BoundNames of CatchParameter, do
  for (const argName of BoundNames(CatchParameter)) {
    // a. Perform ! catchEnv.CreateMutableBinding(argName, false).
    X(catchEnv.CreateMutableBinding(argName, false));
  }
  // 4. Set the running execution context's LexicalEnvironment to catchEnv.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = catchEnv;
  // 5. Let status be BindingInitialization of CatchParameter with arguments thrownValue and catchEnv.
  const status = yield* BindingInitialization(CatchParameter, thrownValue, catchEnv);
  // 6. If status is an abrupt completion, then
  if (status instanceof AbruptCompletion) {
    // a. Set the running execution context's LexicalEnvironment to oldEnv.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
    // b. Return Completion(status).
    return Completion(status);
  }
  // 7. Let B be the result of evaluating Block.
  const blockCompletion = EnsureCompletion(yield* Evaluate(Block));
  // 8. Set the running execution context's LexicalEnvironment to oldEnv.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
  // 9. Return Completion(B).
  return Completion(blockCompletion);
}
