import { Value } from '../value.mts';
import { NormalCompletion } from '../completion.mts';
import { Evaluate } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-module-semantics-runtime-semantics-evaluation */
// Module :
//   [empty]
//   ModuleBody
export function* Evaluate_Module({ ModuleBody }: ParseNode.Module) {
  if (!ModuleBody) {
    return NormalCompletion(Value.undefined);
  }
  return yield* Evaluate(ModuleBody);
}
