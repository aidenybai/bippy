import { NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-empty-statement-runtime-semantics-evaluation */
//   EmptyStatement : `;`
export function Evaluate_EmptyStatement(_EmptyStatement: ParseNode.EmptyStatement) {
  // 1. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}
