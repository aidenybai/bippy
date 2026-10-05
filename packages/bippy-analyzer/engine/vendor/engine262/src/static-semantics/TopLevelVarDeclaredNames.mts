import { isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { BoundNames, VarDeclaredNames } from './all.mts';

export function TopLevelVarDeclaredNames(node: ParseNode | readonly ParseNode[]): string[] {
  if (isArray(node)) {
    const names = [];
    for (const item of node) {
      names.push(...TopLevelVarDeclaredNames(item));
    }
    return names;
  }
  switch (node.type) {
    case 'ClassDeclaration':
    case 'LexicalDeclaration':
    case 'UsingDeclaration':
    case 'AwaitUsingDeclaration':
      return [];
    case 'FunctionDeclaration':
    case 'GeneratorDeclaration':
    case 'AsyncFunctionDeclaration':
    case 'AsyncGeneratorDeclaration':
      return BoundNames(node);
    default:
      return VarDeclaredNames(node);
  }
}
