import type { ParseNode } from '../parser/ParseNode.mts';

export function DeclarationPart<T extends ParseNode>(node: T): T {
  return node;
}
