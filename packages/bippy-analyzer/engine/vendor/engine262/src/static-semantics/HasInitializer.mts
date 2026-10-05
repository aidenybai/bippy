import type { ParseNode } from '../parser/ParseNode.mts';

export function HasInitializer(node: ParseNode): node is ParseNode & { readonly Initializer: ParseNode.Initializer; } {
  return 'Initializer' in node && !!node.Initializer;
}
