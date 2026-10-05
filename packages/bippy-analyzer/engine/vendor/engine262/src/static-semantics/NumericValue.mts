/** https://tc39.es/ecma262/#sec-numericvalue */
import type { ParseNode } from '../parser/ParseNode.mts';

export function NumericValue(node: ParseNode.NumericLiteral): bigint | number {
  return node.value;
}
