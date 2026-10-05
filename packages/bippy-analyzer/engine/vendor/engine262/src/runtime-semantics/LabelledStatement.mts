import type { ParseNode } from '../parser/ParseNode.mts';
import { LabelledEvaluation } from './all.mts';

/** https://tc39.es/ecma262/#sec-labelled-statements-runtime-semantics-evaluation */
export function Evaluate_LabelledStatement(LabelledStatement: ParseNode.LabelledStatement) {
  // 1. Let newLabelSet be a new empty List.
  const newLabelSet = new Set<string>();
  // 2. Return LabelledEvaluation of this LabelledStatement with argument newLabelSet.
  return LabelledEvaluation(LabelledStatement, newLabelSet);
}
