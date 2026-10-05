import type { ParseNode } from '../parser/ParseNode.mts';
import {
  TopLevelLexicallyDeclaredNames,
} from './all.mts';

export function LexicallyDeclaredNames(node: ParseNode): string[] {
  switch (node.type) {
    case 'Script':
      if (node.ScriptBody) {
        return LexicallyDeclaredNames(node.ScriptBody);
      }
      return [];
    case 'ScriptBody':
      return TopLevelLexicallyDeclaredNames(node.StatementList);
    case 'FunctionBody':
    case 'GeneratorBody':
    case 'AsyncBody':
    case 'AsyncGeneratorBody':
      return TopLevelLexicallyDeclaredNames(node.FunctionStatementList);
    case 'ClassStaticBlockBody':
      return TopLevelLexicallyDeclaredNames(node.ClassStaticBlockStatementList);
    default:
      return [];
  }
}
