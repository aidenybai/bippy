import type { ParseNode } from '../parser/ParseNode.mts';

export function IsComputedPropertyKey(node: ParseNode.PropertyNameLike): node is ParseNode.PropertyName {
  return node.type !== 'IdentifierName'
    && node.type !== 'StringLiteral'
    && node.type !== 'NumericLiteral';
}
