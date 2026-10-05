import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-static-semantics-isstrict */
export function IsStrict({ ScriptBody }: ParseNode.Script) {
  // 1. If ScriptBody is present and the Directive Prologue of ScriptBody contains a Use Strict Directive, return true; otherwise, return false.
  return ScriptBody!.strict;
}
