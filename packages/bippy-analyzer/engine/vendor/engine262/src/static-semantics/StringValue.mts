import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

export function StringValue(node: ParseNode): string {
  switch (node.type) {
    case 'IdentifierName':
    case 'BindingIdentifier':
    case 'IdentifierReference':
    case 'LabelIdentifier':
      return node.name;
    case 'PrivateIdentifier':
      return `#${node.name}`;
    case 'StringLiteral':
      return node.value;
    default:
      throw OutOfRange.nonExhaustive(node);
  }
}
