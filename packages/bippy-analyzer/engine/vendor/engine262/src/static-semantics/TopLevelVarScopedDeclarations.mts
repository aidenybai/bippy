import { isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { DeclarationPart, VarScopedDeclarations } from './all.mts';

export function TopLevelVarScopedDeclarations(node: ParseNode | readonly ParseNode[]): VarScopedDeclaration[] {
  if (isArray(node)) {
    const declarations = [];
    for (const item of node) {
      declarations.push(...TopLevelVarScopedDeclarations(item));
    }
    return declarations;
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
      return [DeclarationPart(node)];
    default:
      return VarScopedDeclarations(node);
  }
}

export type VarScopedDeclaration =
  | ParseNode.ForBinding
  | ParseNode.VariableDeclaration
  | ParseNode.FunctionDeclaration
  | ParseNode.GeneratorDeclaration
  | ParseNode.AsyncFunctionDeclaration
  | ParseNode.AsyncGeneratorDeclaration
  | ParseNode.BindingIdentifier;
