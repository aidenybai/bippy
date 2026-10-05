import type { ParseNode } from '../parser/ParseNode.mts';

export function IsAwaitUsingDeclaration(node: ParseNode) {
  switch (node.type) {
    case 'AwaitUsingDeclaration':
      return true;
    case 'ForDeclaration':
      return node.production === 'AwaitUsing';
    default:
      return false;
  }
}
