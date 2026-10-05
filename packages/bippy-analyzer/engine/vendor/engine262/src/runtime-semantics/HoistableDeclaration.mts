import { NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-statement-semantics-runtime-semantics-evaluation */
//   HoistableDeclaration :
//     GeneratorDeclaration
//     AsyncFunctionDeclaration
//     AsyncGeneratorDeclaration
export function Evaluate_HoistableDeclaration(_HoistableDeclaration: ParseNode.HoistableDeclaration) {
  // 1. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}
