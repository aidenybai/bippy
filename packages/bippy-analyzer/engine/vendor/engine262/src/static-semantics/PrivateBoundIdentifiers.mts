import { isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { StringValue } from './all.mts';

/** https://tc39.es/ecma262/#sec-static-semantics-privateboundidentifiers */
export function PrivateBoundIdentifiers(node: ParseNode | readonly ParseNode[]): string[] {
  if (isArray(node)) {
    return node.flatMap((n) => PrivateBoundIdentifiers(n));
  }
  switch (node.type) {
    case 'PrivateIdentifier':
      return [StringValue(node)];
    case 'MethodDefinition':
    case 'GeneratorMethod':
    case 'AsyncMethod':
    case 'AsyncGeneratorMethod':
    case 'FieldDefinition':
      return PrivateBoundIdentifiers(node.ClassElementName);
    default:
      return [];
  }
}
