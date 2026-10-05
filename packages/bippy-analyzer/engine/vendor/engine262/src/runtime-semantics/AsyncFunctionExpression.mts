import type { ParseNode } from '../parser/ParseNode.mts';
import { InstantiateAsyncFunctionExpression } from './all.mts';

/** https://tc39.es/ecma262/#sec-async-function-definitions-runtime-semantics-evaluation */
//   AsyncFunctionExpression :
//     `async` `function` `(` FormalParameters `)` `{` AsyncBody `}`
//     `async` `function` BindingIdentifier `(` FormalParameters `)` `{` AsyncBody `}`
export function Evaluate_AsyncFunctionExpression(AsyncFunctionExpression: ParseNode.AsyncFunctionExpression) {
  // 1. Return InstantiateAsyncFunctionExpression of AsyncFunctionExpression.
  return InstantiateAsyncFunctionExpression(AsyncFunctionExpression);
}
