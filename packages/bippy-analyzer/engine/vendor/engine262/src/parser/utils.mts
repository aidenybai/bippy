import type { ParseNode } from '#self';

export type TargetSymbol = ParseNode['type'] | 'super' | 'this';

/** https://tc39.es/ecma262/#sec-static-semantics-contains */
export function Contains(node: ParseNode, symbol: TargetSymbol): boolean {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'GeneratorDeclaration':
    case 'GeneratorExpression':
    case 'AsyncGeneratorDeclaration':
    case 'AsyncGeneratorExpression':
    case 'AsyncFunctionDeclaration':
    case 'AsyncFunctionExpression':
      return false;
    case 'ClassTail': {
      // We don't have ClassBody?
      throw new Error('TODO');
    }
    case 'ClassStaticBlock':
      return false;
    case 'ArrowFunction':
    case 'AsyncArrowFunction':
      throw new Error('TODO');
    case 'PropertyDefinition': {
      // Note && TODO: PropertyDefinition in spec refers to MethodDefinition here,
      // but our PropertyDefinition is parital one.
      // We should check this at all use site of PropertyDefinitionList.
      break;
    }
    //  LiteralPropertyName : IdentifierName
    // throw new Error('TODO');
    case 'MemberExpression': {
      //  MemberExpression : MemberExpression . IdentifierName
      if (node.IdentifierName) {
        return Contains(node.MemberExpression, symbol);
      }
      break;
    }
    case 'SuperProperty': {
      if (node.IdentifierName) {
        return symbol === 'super';
      }
      break;
    }
    case 'CallExpression': {
      throw new Error('TODO');
    }
    case 'OptionalChain': {
      if (node.IdentifierName) {
        //  OptionalChain : OptionalChain . IdentifierName
        if (node.OptionalChain) {
          return Contains(node.OptionalChain, symbol);
        }
        //  OptionalChain : ?. IdentifierName
        return false;
      }
      break;
    }
    default:
  }

  // 1. For each child node child of this Parse Node
  for (const child of avoid_using_children(node)) {
    // a. If child is an instance of symbol, return true.
    if (child.type === symbol) {
      return true;
    }
    // b. If child is an instance of a nonterminal, then
    const contained = Contains(child, symbol);
    // i. If contained is true, return true.
    if (contained) {
      return true;
    }
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-static-semantics-arrayliteralcontentnodes */
export function ArrayLiteralContentNodes(node: ParseNode.ArrayLiteral) {
  return node.ElementList;
}

/** https://tc39.es/ecma262/#sec-static-semantics-propertydefinitionnodes */
export function PropertyDefinitionNodes(node: ParseNode.ObjectLiteral) {
  return node.PropertyDefinitionList;
}

// Note: this is not a correct forEachChild implementation, but it is not worth the effort to implement it fully.
// defer it to the future if needed.
export function* avoid_using_children(node: ParseNode): Generator<ParseNode> {
  for (const key of Reflect.ownKeys(node)) {
    if (typeof key === 'string' && key !== 'parent' && key !== 'type' && key !== 'location' && key !== 'sourceText') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child = (node as any)[key];
      if (typeof child === 'object' && child) {
        if (Array.isArray(child)) {
          for (const element of child) {
            if (isParseNode(element)) {
              yield element;
            }
          }
        } else if ('type' in child) {
          yield child;
        }
      }
    }
  }
}

function isParseNode(value: unknown): value is ParseNode {
  return !!(value && typeof value === 'object' && 'type' in value && 'location' in value);
}
