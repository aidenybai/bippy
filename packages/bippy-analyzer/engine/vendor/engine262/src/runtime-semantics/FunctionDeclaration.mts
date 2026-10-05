import { NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-evaluation */
// FunctionDeclaration :
//   function BindingIdentifier ( FormalParameters ) { FunctionBody }
//   function ( FormalParameters ) { FunctionBody }
export function Evaluate_FunctionDeclaration(_FunctionDeclaration: ParseNode.FunctionDeclaration) {
  return NormalCompletion(undefined);
}
