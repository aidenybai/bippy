import { Completion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { StringValue } from '../static-semantics/all.mts';

/** https://tc39.es/ecma262/#sec-break-statement-runtime-semantics-evaluation */
//   BreakStatement :
//     `break` `;`
//     `break` LabelIdentifier `;`
export function Evaluate_BreakStatement({ LabelIdentifier }: ParseNode.BreakStatement) {
  if (!LabelIdentifier) {
    // 1. Return Completion { [[Type]]: break, [[Value]]: empty, [[Target]]: empty }.
    return new Completion({ Type: 'break', Value: undefined, Target: undefined });
  }
  // 1. Let label be the StringValue of LabelIdentifier.
  const label = StringValue(LabelIdentifier);
  // 2. Return Completion { [[Type]]: break, [[Value]]: empty, [[Target]]: label }.
  return new Completion({ Type: 'break', Value: undefined, Target: label });
}
