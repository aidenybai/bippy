import type { ParseNode } from '../parser/ParseNode.mts';
import { IsAwaitUsingDeclaration } from './IsAwaitUsingDeclaration.mts';
import { IsUsingDeclaration } from './IsUsingDeclaration.mts';

/** https://tc39.es/ecma262/#sec-static-semantics-containsusing */
export function ContainsUsing(node: ParseNode.StatementList | ParseNode.StatementListItem): boolean {
  // StatementList : StatementList StatementListItem
  if (!('type' in node)) {
    return node.some(ContainsUsing);
  }

  // StatementListItem : Statement
  // StatementListItem : Declaration
  return IsUsingDeclaration(node) || IsAwaitUsingDeclaration(node);
}
