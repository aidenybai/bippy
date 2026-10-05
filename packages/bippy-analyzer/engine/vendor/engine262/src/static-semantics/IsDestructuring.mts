import type { ParseNode } from '../parser/ParseNode.mts';

export type DestructuringParseNode = ParseNode.ObjectBindingPattern | ParseNode.ArrayBindingPattern | ParseNode.ObjectLiteral | ParseNode.ArrayLiteral | ParseNode.ForDeclaration | ParseNode.ForBinding;
export function IsDestructuring(node: ParseNode): boolean {
  switch (node.type) {
    case 'ObjectBindingPattern':
    case 'ArrayBindingPattern':
    case 'ObjectLiteral':
    case 'ArrayLiteral':
      return true;
    case 'ForDeclaration':
      return node.production === 'LetOrConst' && IsDestructuring(node.ForBinding);
    case 'ForBinding':
      if (node.BindingIdentifier) {
        return false;
      }
      return true;
    default:
      return false;
  }
}
