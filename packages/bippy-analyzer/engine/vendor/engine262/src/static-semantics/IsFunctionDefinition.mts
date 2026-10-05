import type { ParseNode } from '../parser/ParseNode.mts';

export type FunctionDeclaration = ParseNode.FunctionExpression | ParseNode.GeneratorExpression | ParseNode.AsyncFunctionExpression | ParseNode.AsyncGeneratorExpression | ParseNode.ClassExpression | ParseNode.ArrowFunction | ParseNode.AsyncArrowFunction | ParseNode.ParenthesizedExpression & { readonly Expression: FunctionDeclaration };
export function IsFunctionDefinition(node: ParseNode): node is FunctionDeclaration {
  if (node.type === 'ParenthesizedExpression') {
    return IsFunctionDefinition(node.Expression);
  }
  return node.type === 'FunctionExpression'
    || node.type === 'GeneratorExpression'
    || node.type === 'AsyncGeneratorExpression'
    || node.type === 'AsyncFunctionExpression'
    || node.type === 'ClassExpression'
    || node.type === 'ArrowFunction'
    || node.type === 'AsyncArrowFunction';
}
