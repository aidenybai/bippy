import { isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { BoundNames, TopLevelVarDeclaredNames } from './all.mts';

export function VarDeclaredNames(node: ParseNode | readonly ParseNode[]): string[] {
  if (isArray(node)) {
    const names = [];
    for (const item of node) {
      names.push(...VarDeclaredNames(item));
    }
    return names;
  }
  switch (node.type) {
    case 'VariableStatement':
      return BoundNames(node.VariableDeclarationList);
    case 'VariableDeclaration':
      return BoundNames(node);
    case 'IfStatement': {
      const names = VarDeclaredNames(node.Statement_a);
      if (node.Statement_b) {
        names.push(...VarDeclaredNames(node.Statement_b));
      }
      return names;
    }
    case 'Block':
      return VarDeclaredNames(node.StatementList);
    case 'WhileStatement':
      return VarDeclaredNames(node.Statement);
    case 'DoWhileStatement':
      return VarDeclaredNames(node.Statement);
    case 'ForStatement': {
      const names = [];
      if (node.VariableDeclarationList) {
        names.push(...VarDeclaredNames(node.VariableDeclarationList));
      }
      names.push(...VarDeclaredNames(node.Statement));
      return names;
    }
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'ForAwaitStatement': {
      const names = [];
      if (node.ForBinding) {
        names.push(...BoundNames(node.ForBinding));
      }
      names.push(...VarDeclaredNames(node.Statement));
      return names;
    }
    case 'WithStatement':
      return VarDeclaredNames(node.Statement);
    case 'SwitchStatement':
      return VarDeclaredNames(node.CaseBlock);
    case 'CaseBlock': {
      const names = [];
      if (node.CaseClauses_a) {
        names.push(...VarDeclaredNames(node.CaseClauses_a));
      }
      if (node.DefaultClause) {
        names.push(...VarDeclaredNames(node.DefaultClause));
      }
      if (node.CaseClauses_b) {
        names.push(...VarDeclaredNames(node.CaseClauses_b));
      }
      return names;
    }
    case 'CaseClause':
    case 'DefaultClause':
      if (node.StatementList) {
        return VarDeclaredNames(node.StatementList);
      }
      return [];
    case 'LabelledStatement':
      return VarDeclaredNames(node.LabelledItem);
    case 'TryStatement': {
      const names = VarDeclaredNames(node.Block);
      if (node.Catch) {
        names.push(...VarDeclaredNames(node.Catch));
      }
      if (node.Finally) {
        names.push(...VarDeclaredNames(node.Finally));
      }
      return names;
    }
    case 'Catch':
      return VarDeclaredNames(node.Block);
    case 'Script':
      if (node.ScriptBody) {
        return VarDeclaredNames(node.ScriptBody);
      }
      return [];
    case 'ScriptBody':
      return TopLevelVarDeclaredNames(node.StatementList);
    case 'FunctionBody':
    case 'GeneratorBody':
    case 'AsyncBody':
    case 'AsyncGeneratorBody':
      return TopLevelVarDeclaredNames(node.FunctionStatementList);
    case 'ClassStaticBlockBody':
      return TopLevelVarDeclaredNames(node.ClassStaticBlockStatementList);
    case 'ExportDeclaration':
      if (node.VariableStatement) {
        return BoundNames(node);
      }
      return [];
    default:
      return [];
  }
}
