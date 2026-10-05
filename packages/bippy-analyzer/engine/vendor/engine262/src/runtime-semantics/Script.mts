import { Value } from '../value.mts';
import { NormalCompletion } from '../completion.mts';
import { Evaluate } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-script-semantics-runtime-semantics-evaluation */
// Script :
//   [empty]
//   ScriptBody
export function* Evaluate_Script({ ScriptBody }: ParseNode.Script) {
  if (!ScriptBody) {
    return NormalCompletion(Value.undefined);
  }
  return yield* Evaluate(ScriptBody);
}
