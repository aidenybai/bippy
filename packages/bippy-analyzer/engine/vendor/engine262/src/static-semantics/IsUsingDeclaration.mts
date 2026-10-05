import type { ParseNode } from '../parser/ParseNode.mts';

export function IsUsingDeclaration(node: ParseNode) {
  switch (node.type) {
    case 'UsingDeclaration':
      return true;
    case 'ForDeclaration':
      return node.production === 'Using';
    default:
      return false;
  }
}
