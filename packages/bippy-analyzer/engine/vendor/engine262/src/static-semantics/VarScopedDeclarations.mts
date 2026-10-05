import { isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { TopLevelVarScopedDeclarations, type VarScopedDeclaration } from './all.mts';

export function VarScopedDeclarations(node: ParseNode | readonly ParseNode[]): VarScopedDeclaration[] {
  if (isArray(node)) {
    const declarations = [];
    for (const item of node) {
      declarations.push(...VarScopedDeclarations(item));
    }
    return declarations;
  }
  switch (node.type) {
    case 'VariableStatement':
      return VarScopedDeclarations(node.VariableDeclarationList);
    case 'VariableDeclaration':
      return [node];
    case 'Block':
      return VarScopedDeclarations(node.StatementList);
    case 'IfStatement': {
      const declarations = VarScopedDeclarations(node.Statement_a);
      if (node.Statement_b) {
        declarations.push(...VarScopedDeclarations(node.Statement_b));
      }
      return declarations;
    }
    case 'WhileStatement':
      return VarScopedDeclarations(node.Statement);
    case 'DoWhileStatement':
      return VarScopedDeclarations(node.Statement);
    case 'ForStatement': {
      const names = [];
      if (node.VariableDeclarationList) {
        names.push(...VarScopedDeclarations(node.VariableDeclarationList));
      }
      names.push(...VarScopedDeclarations(node.Statement));
      return names;
    }
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'ForAwaitStatement': {
      const declarations = [];
      if (node.ForBinding) {
        declarations.push(node.ForBinding);
      }
      declarations.push(...VarScopedDeclarations(node.Statement));
      return declarations;
    }
    case 'WithStatement':
      return VarScopedDeclarations(node.Statement);
    case 'SwitchStatement':
      return VarScopedDeclarations(node.CaseBlock);
    case 'CaseBlock': {
      const names = [];
      if (node.CaseClauses_a) {
        names.push(...VarScopedDeclarations(node.CaseClauses_a));
      }
      if (node.DefaultClause) {
        names.push(...VarScopedDeclarations(node.DefaultClause));
      }
      if (node.CaseClauses_b) {
        names.push(...VarScopedDeclarations(node.CaseClauses_b));
      }
      return names;
    }
    case 'CaseClause':
    case 'DefaultClause':
      if (node.StatementList) {
        return VarScopedDeclarations(node.StatementList);
      }
      return [];
    case 'LabelledStatement':
      return VarScopedDeclarations(node.LabelledItem);
    case 'TryStatement': {
      const declarations = VarScopedDeclarations(node.Block);
      if (node.Catch) {
        declarations.push(...VarScopedDeclarations(node.Catch));
      }
      if (node.Finally) {
        declarations.push(...VarScopedDeclarations(node.Finally));
      }
      return declarations;
    }
    case 'Catch':
      return VarScopedDeclarations(node.Block);
    case 'ExportDeclaration':
      if (node.VariableStatement) {
        return VarScopedDeclarations(node.VariableStatement);
      }
      return [];
    case 'Script':
      if (node.ScriptBody) {
        return VarScopedDeclarations(node.ScriptBody);
      }
      return [];
    case 'ScriptBody':
      return TopLevelVarScopedDeclarations(node.StatementList);
    case 'Module':
      if (node.ModuleBody) {
        return VarScopedDeclarations(node.ModuleBody);
      }
      return [];
    case 'ModuleBody':
      return VarScopedDeclarations(node.ModuleItemList);
    case 'FunctionBody':
    case 'GeneratorBody':
    case 'AsyncBody':
    case 'AsyncGeneratorBody':
      return TopLevelVarScopedDeclarations(node.FunctionStatementList);
    case 'ClassStaticBlockBody':
      return TopLevelVarScopedDeclarations(node.ClassStaticBlockStatementList);
    default:
      return [];
  }
}
