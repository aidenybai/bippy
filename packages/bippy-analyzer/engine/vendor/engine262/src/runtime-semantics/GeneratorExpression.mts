import type { ParseNode } from '../parser/ParseNode.mts';
import { InstantiateGeneratorFunctionExpression } from './all.mts';

/** https://tc39.es/ecma262/#sec-generator-function-definitions-runtime-semantics-evaluation */
//   GeneratorExpression :
//     `function` `*` `(` FormalParameters `)` `{` GeneratorBody `}`
//     `function` `*` BindingIdentifier `(` FormalParameters `)` `{` GeneratorBody `}`
export function Evaluate_GeneratorExpression(GeneratorExpression: ParseNode.GeneratorExpression) {
  // 1. Return InstantiateGeneratorFunctionExpression of GeneratorExpression.
  return InstantiateGeneratorFunctionExpression(GeneratorExpression);
}
