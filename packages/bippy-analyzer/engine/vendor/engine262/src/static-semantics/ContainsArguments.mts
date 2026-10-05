import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-static-semantics-containsarguments */
export function ContainsArguments(node: ParseNode): ParseNode.IdentifierReference | null {
  switch (node.type) {
    case 'IdentifierReference':
      if (node.name === 'arguments') {
        return node;
      }
      return null;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'MethodDefinition':
    case 'GeneratorMethod':
    case 'GeneratorDeclaration':
    case 'GeneratorExpression':
    case 'AsyncMethod':
    case 'AsyncFunctionDeclaration':
    case 'AsyncFunctionExpression':
      return null;
    default:
      for (const value of Object.values(node)) {
        // TODO(ts): This function does not accept a ParseNode[], when isArray(value), ContainsArguments should never return a result?
        if ((value?.type || Array.isArray(value))) {
          const maybe = ContainsArguments(value);
          if (maybe) {
            return maybe;
          }
        }
      }
      return null;
  }
}
