import type { ParseNode } from '../parser/ParseNode.mts';
import { InstantiateAsyncArrowFunctionExpression } from './all.mts';

/** https://tc39.es/ecma262/#sec-async-arrow-function-definitions-runtime-semantics-evaluation */
export function Evaluate_AsyncArrowFunction(AsyncArrowFunction: ParseNode.AsyncArrowFunction) {
  // 1. Return InstantiateAsyncArrowFunctionExpression of AsyncArrowFunction.
  return InstantiateAsyncArrowFunctionExpression(AsyncArrowFunction);
}
