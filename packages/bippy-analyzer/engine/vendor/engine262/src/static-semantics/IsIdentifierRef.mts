import type { ParseNode } from '../parser/ParseNode.mts';

export function IsIdentifierRef(node: ParseNode): node is ParseNode.IdentifierReference {
  return node.type === 'IdentifierReference';
}
