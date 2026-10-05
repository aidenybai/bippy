import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate_StatementList } from './all.mts';

/** https://tc39.es/ecma262/#sec-module-semantics-runtime-semantics-evaluation */
// ModuleBody : ModuleItemList
export function Evaluate_ModuleBody({ ModuleItemList }: ParseNode.ModuleBody) {
  // TODO(ts): ModuleItemList might contain ImportDeclaration or ExportDeclaration which is not accepted by Evaluate_StatementList.
  // @ts-expect-error
  return Evaluate_StatementList(ModuleItemList);
}
