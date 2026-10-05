import { NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-module-semantics-runtime-semantics-evaluation */
// ModuleItem : ImportDeclaration
export function Evaluate_ImportDeclaration(_ImportDeclaration: ParseNode.ImportDeclaration) {
  // 1. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}
