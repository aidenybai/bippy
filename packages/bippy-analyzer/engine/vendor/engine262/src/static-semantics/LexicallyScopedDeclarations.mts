import { isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { TopLevelLexicallyScopedDeclarations, DeclarationPart } from './all.mts';

export function LexicallyScopedDeclarations(node: ParseNode | readonly ParseNode[]): (ParseNode.Declaration | ParseNode.ExportDeclaration)[] {
  if (isArray(node)) {
    const declarations = [];
    for (const item of node) {
      declarations.push(...LexicallyScopedDeclarations(item));
    }
    return declarations;
  }
  switch (node.type) {
    case 'LabelledStatement':
      return LexicallyScopedDeclarations(node.LabelledItem);
    case 'Script':
      if (node.ScriptBody) {
        return LexicallyScopedDeclarations(node.ScriptBody);
      }
      return [];
    case 'ScriptBody':
      return TopLevelLexicallyScopedDeclarations(node.StatementList);
    case 'Module':
      if (node.ModuleBody) {
        return LexicallyScopedDeclarations(node.ModuleBody);
      }
      return [];
    case 'ModuleBody':
      return LexicallyScopedDeclarations(node.ModuleItemList);
    case 'FunctionBody':
    case 'GeneratorBody':
    case 'AsyncBody':
    case 'AsyncGeneratorBody':
      return TopLevelLexicallyScopedDeclarations(node.FunctionStatementList);
    case 'ClassStaticBlockBody':
      return TopLevelLexicallyScopedDeclarations(node.ClassStaticBlockStatementList);
    case 'ImportDeclaration':
      return [];
    case 'ClassDeclaration':
    case 'LexicalDeclaration':
    case 'UsingDeclaration':
    case 'AwaitUsingDeclaration':
    case 'FunctionDeclaration':
    case 'GeneratorDeclaration':
    case 'AsyncFunctionDeclaration':
    case 'AsyncGeneratorDeclaration':
      return [DeclarationPart(node)];
    case 'CaseBlock': {
      const names = [];
      if (node.CaseClauses_a) {
        names.push(...LexicallyScopedDeclarations(node.CaseClauses_a));
      }
      if (node.DefaultClause) {
        names.push(...LexicallyScopedDeclarations(node.DefaultClause));
      }
      if (node.CaseClauses_b) {
        names.push(...LexicallyScopedDeclarations(node.CaseClauses_b));
      }
      return names;
    }
    case 'CaseClause':
    case 'DefaultClause':
      if (node.StatementList) {
        return LexicallyScopedDeclarations(node.StatementList);
      }
      return [];
    case 'ExportDeclaration':
      if (node.Declaration) {
        return [DeclarationPart(node.Declaration)];
      }
      if (node.HoistableDeclaration) {
        return [DeclarationPart(node.HoistableDeclaration)];
      }
      if (node.ClassDeclaration) {
        return [node.ClassDeclaration];
      }
      if (node.AssignmentExpression) {
        return [node];
      }
      return [];
    default:
      return [];
  }
}
