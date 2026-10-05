import type { Mutable } from '../utils/language.mts';
import { ContainsUsing } from '../static-semantics/ContainsUsing.mts';
import { ModuleParser } from './ModuleParser.mts';
import type { ParseNode } from './ParseNode.mts';
import { Token } from './tokens.mts';
import { Throw } from '#self';

export abstract class LanguageParser extends ModuleParser {
  // Script : ScriptBody?
  parseScript(): ParseNode.Script {
    this.skipHashbangComment();
    const node = this.startNode<ParseNode.Script>();
    if (this.eat(Token.EOS)) {
      node.ScriptBody = null;
    } else {
      node.ScriptBody = this.parseScriptBody();
      if (ContainsUsing(node.ScriptBody.StatementList)) {
        this.addEarlyError(Throw.SyntaxError('Using declarations are not allowed at the top level of a Script'), node.ScriptBody);
      }
    }
    Object.defineProperty(node, 'sourceText', {
      configurable: true,
      get: () => this.source,
    });
    return this.finishNode(node, 'Script');
  }

  // ScriptBody : StatementList
  parseScriptBody(): ParseNode.ScriptBody {
    const node = this.startNode<ParseNode.ScriptBody>();
    this.scope.with({
      in: true,
      lexical: true,
      variable: true,
      variableFunctions: true,
    }, () => {
      const directives: string[] = [];
      node.StatementList = this.parseStatementList(Token.EOS, directives);
      node.strict = directives.includes('use strict');
    });
    Object.defineProperty(node, 'sourceText', {
      configurable: true,
      get: () => this.source,
    });
    return this.finishNode(node, 'ScriptBody');
  }

  // Module : ModuleBody?
  parseModule(): ParseNode.Module {
    this.skipHashbangComment();
    return this.scope.with({
      module: true,
      strict: true,
      in: true,
      importMeta: true,
      await: true,
      lexical: true,
      variable: true,
    }, () => {
      const node = this.startNode<ParseNode.Module>();
      if (this.eat(Token.EOS)) {
        node.ModuleBody = null;
      } else {
        node.ModuleBody = this.parseModuleBody();
      }
      this.scope.undefinedExports.forEach((importNode, name) => {
        this.addEarlyError(Throw.SyntaxError('Module undefined export $1', name), importNode);
      });
      node.hasTopLevelAwait = this.state.hasTopLevelAwait;
      Object.defineProperty(node, 'sourceText', {
        configurable: true,
        get: () => this.source,
      });
      return this.finishNode(node, 'Module');
    });
  }

  // ModuleBody :
  //   ModuleItemList
  parseModuleBody(): ParseNode.ModuleBody {
    const node = this.startNode<ParseNode.ModuleBody>();
    node.ModuleItemList = this.parseModuleItemList();
    Object.defineProperty(node, 'sourceText', {
      configurable: true,
      get: () => this.source,
    });
    return this.finishNode(node, 'ModuleBody');
  }

  // ModuleItemList :
  //   ModuleItem
  //   ModuleItemList ModuleItem
  //
  // ModuleItem :
  //   ImportDeclaration
  //   ExportDeclaration
  //   StatementListItem
  parseModuleItemList(): ParseNode.ModuleItemList {
    const moduleItemList: Mutable<ParseNode.ModuleItemList> = [];
    while (!this.eat(Token.EOS)) {
      switch (this.peek().type) {
        case Token.IMPORT:
          moduleItemList.push(this.parseImportDeclaration());
          break;
        case Token.EXPORT:
          moduleItemList.push(this.parseExportDeclaration(null));
          break;
        case Token.AT: {
          const decorators = this.parseDecorators();
          if (this.peek().type === Token.EXPORT) {
            // ModuleItem: DecoratorList `export` Declaration
            const exports = this.parseExportDeclaration(decorators);
            // TODO(decorator):
            // ExportDeclaration : DecoratorList? `export` Declaration
            //   It is a Syntax Error if DecoratorList is present and Declaration is not ClassDeclaration.
            if (!exports.ClassDeclaration) {
              this.addEarlyError(Throw.SyntaxError('Decorators can only be used to decorate classes'), exports.AssignmentExpression || exports.Declaration || exports.ExportFromClause || exports.FromClause || exports.HoistableDeclaration || exports.VariableStatement || exports.WithClause || exports);
            }
            //   It is a Syntax Error if DecoratorList is present, Declaration is a ClassDeclaration, and the DecoratorList of that ClassDeclaration is present.
            // ExportDeclaration : DecoratorList? export default ClassDeclaration
            //   It is a Syntax Error if DecoratorList is present and the DecoratorList of ClassDeclaration is present.
            if (exports.ClassDeclaration && exports.ClassDeclaration.Decorators?.length) {
              this.addEarlyError(Throw.SyntaxError('Decorators cannot appear on both sides of the export keyword'), exports.ClassDeclaration.Decorators[0]);
            }
            moduleItemList.push(exports);
          } else {
            // ModuleItem : DecoratorList ClassDeclaration
            const classDecl = this.parseClassDeclaration(decorators);
            moduleItemList.push(classDecl);
          }
          break;
        }
        default:
          moduleItemList.push(this.parseStatementListItem());
          break;
      }
    }
    return moduleItemList;
  }
}
