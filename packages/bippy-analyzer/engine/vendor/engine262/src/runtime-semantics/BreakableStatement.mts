import type { ParseNode } from '../parser/ParseNode.mts';
import { LabelledEvaluation } from './all.mts';

/** https://tc39.es/ecma262/#sec-statement-semantics-runtime-semantics-evaluation */
//   BreakableStatement :
//     IterationStatement
//     SwitchStatement
//
//   IterationStatement :
//     (DoStatement)
//     (WhileStatement)
export function Evaluate_BreakableStatement(BreakableStatement: ParseNode.BreakableStatement) {
  // 1. Let newLabelSet be a new empty List.
  const newLabelSet = new Set<string>();
  // 2. Return the result of performing LabelledEvaluation of this BreakableStatement with argument newLabelSet.
  return LabelledEvaluation(BreakableStatement, newLabelSet);
}
