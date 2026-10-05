import { isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { BoundNames } from './all.mts';

export function TopLevelLexicallyDeclaredNames(node: ParseNode | readonly ParseNode[]): string[] {
  if (isArray(node)) {
    const names = [];
    for (const StatementListItem of node) {
      names.push(...TopLevelLexicallyDeclaredNames(StatementListItem));
    }
    return names;
  }
  switch (node.type) {
    case 'ClassDeclaration':
    case 'LexicalDeclaration':
    case 'UsingDeclaration':
    case 'AwaitUsingDeclaration':
      return BoundNames(node);
    default:
      return [];
  }
}
