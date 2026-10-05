import type { ParseNode } from '../parser/ParseNode.mts';
import { InstantiateAsyncGeneratorFunctionExpression } from './all.mts';

/** https://tc39.es/ecma262/#sec-asyncgenerator-definitions-evaluation */
//   AsyncGeneratorExpression :
//     `async` `function` `*` `(` FormalParameters `)` `{` AsyncGeneratorBody `}`
//     `async` `function` `*` BindingIdentifier `(` FormalParameters `)` `{` AsyncGeneratorBody `}`
export function Evaluate_AsyncGeneratorExpression(AsyncGeneratorExpression: ParseNode.AsyncGeneratorExpression) {
  // 1. Return InstantiateAsyncGeneratorFunctionExpression of AsyncGeneratorExpression.
  return InstantiateAsyncGeneratorFunctionExpression(AsyncGeneratorExpression);
}
