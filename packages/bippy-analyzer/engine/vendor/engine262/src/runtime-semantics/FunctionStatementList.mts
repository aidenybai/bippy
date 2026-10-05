import type { ParseNode } from '../parser/ParseNode.mts';
import { EnsureCompletion } from '../completion.mts';
import { DisposeResources } from '../abstract-ops/disposable-operations.mts';
import { Evaluate_StatementList } from './all.mts';
import { Assert, DeclarativeEnvironmentRecord, Q, surroundingAgent, type StatementEvaluator } from '#self';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-evaluation */
//   FunctionStatementList : [empty]
//
// (implicit)
//   FunctionStatementList : StatementList
export function* Evaluate_FunctionStatementList(FunctionStatementList: ParseNode.FunctionStatementList): StatementEvaluator {
  const result = EnsureCompletion(yield* Evaluate_StatementList(FunctionStatementList));
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  Assert(env instanceof DeclarativeEnvironmentRecord);
  return Q(yield* DisposeResources(env.DisposableResourceStack, result));
}
