import { NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { surroundingAgent } from '#self';
import { Assert, type StatementEvaluator } from '#self';

/** https://tc39.es/ecma262/#sec-debugger-statement-runtime-semantics-evaluation */
// DebuggerStatement : `debugger` `;`
export function* Evaluate_DebuggerStatement(_node: ParseNode.DebuggerStatement): StatementEvaluator {
  // 1. If an implementation-defined debugging facility is available and enabled, then
  if (surroundingAgent.hostDefinedOptions.onDebugger) {
    // a. Perform an implementation-defined debugging action.
    // b. Let result be an implementation-defined Completion value.
    // TODO(debugger): this should respect conditional breakpoints.
    const completion = yield { suspend: 'debugger' };
    Assert(completion.resume === 'debugger');
    return completion.value;
  }
  // 2. Return result.
  return NormalCompletion(undefined);
}
