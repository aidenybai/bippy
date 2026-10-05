import { IsStringWellFormedUnicode, StringValue } from '../static-semantics/all.mts';
import type { Mutable } from '../utils/language.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { Token, isKeywordRaw } from './tokens.mts';
import { StatementParser } from './StatementParser.mts';
import { FunctionKind } from './FunctionParser.mts';
import type { ParseNode } from './ParseNode.mts';
import { surroundingAgent } from '#self';

export abstract class ModuleParser extends StatementParser {
  // ImportDeclaration :
  //   `import` ImportClause FromClause WithClause? `;`
  //   `import` ModuleSpecifier WithClause? `;`
  //   `import` `source` ImportedBinding FromClause WithClause? `;`
  parseImportDeclaration(): ParseNode.ImportDeclaration | ParseNode.ExpressionStatement | ParseNode.LabelledStatement {
    if (this.testAhead(Token.PERIOD) || this.testAhead(Token.LPAREN)) {
      // `import` `(`
      // `import` `.`
      return this.parseExpressionStatement();
    }
    const node = this.startNode<ParseNode.ImportDeclaration>();
    this.next();
    if (this.test(Token.STRING)) {
      node.Phase = 'evaluation';
      node.ModuleSpecifier = this.parsePrimaryExpression();
    } else {
      if (this.test('source')) {
        const importClause = this.startNode<ParseNode.ImportClause>();
        importClause.ImportedDefaultBinding = this.parseImportedDefaultBinding();

        let isImportSource = false;
        if (this.test('from')) {
          // import source from '...' (normal import)
          // import source from from '...' (import source)
          //               ^ this.test('from')
          //                    ^ this.testAhead(Token.STRING)
          isImportSource = !this.testAhead(Token.STRING);
        } else {
          // import source , { ... } from '...' (normal import)
          // import source x from '...' (import source)
          //               ^ this.test(Token.COMMA)
          isImportSource = !this.test(Token.COMMA);
        }

        if (isImportSource) {
          node.Phase = 'source';
          node.ImportedBinding = this.parseBindingIdentifier();
          this.scope.declare(node.ImportedBinding, 'import');
        } else {
          node.Phase = 'evaluation';
          node.ImportClause = this.parseImportClause(importClause);
          this.scope.declare(node.ImportClause, 'import');
        }
      } else if (this.test('defer') && (this.testAhead(Token.MUL) || this.testAhead(Token.LBRACE))) {
        this.next(); // defer
        node.Phase = 'defer';
        const importClause = this.startNode<ParseNode.ImportClause>();
        if (this.test(Token.MUL)) {
          importClause.NameSpaceImport = this.parseNameSpaceImport();
        } else {
          this.expect(Token.LBRACE);
          importClause.NameSpaceImport = this.parseFilteredNameSpaceImport(this.parseNamedImports());
        }
        node.ImportClause = this.finishNode(importClause, 'ImportClause');
        this.scope.declare(node.ImportClause, 'import');
      } else {
        node.Phase = 'evaluation';
        node.ImportClause = this.parseImportClause();
        this.scope.declare(node.ImportClause, 'import');
      }
      node.FromClause = this.parseFromClause();
    }
    if (this.test(Token.WITH)) {
      node.WithClause = this.parseWithClause();
    }
    this.semicolon();
    return this.finishNode(node, 'ImportDeclaration');
  }

  // ImportClause :
  //   ImportedDefaultBinding
  //   NameSpaceImport
  //   NamedImports
  //   ImportedDefaultBinding `,` NameSpaceImport
  //   ImportedDefaultBinding `,` NamedImports
  //
  // ImportedBinding :
  //   BindingIdentifier
  parseImportClause(node = this.startNode<ParseNode.ImportClause>()): ParseNode.ImportClause {
    if (this.test(Token.IDENTIFIER)) {
      node.ImportedDefaultBinding ??= this.parseImportedDefaultBinding();
      if (!this.eat(Token.COMMA)) {
        return this.finishNode(node, 'ImportClause');
      }
    }
    if (this.test(Token.MUL)) {
      node.NameSpaceImport = this.parseNameSpaceImport();
    } else if (this.eat(Token.LBRACE)) {
      const namedImports = this.parseNamedImports();
      if (this.eat('as')) {
        node.NameSpaceImport = this.parseFilteredNameSpaceImport(namedImports);
      } else {
        node.NamedImports = namedImports;
      }
    } else {
      this.unexpected();
    }
    return this.finishNode(node, 'ImportClause');
  }

  // ImportedDefaultBinding :
  //   ImportedBinding
  parseImportedDefaultBinding(): ParseNode.ImportedDefaultBinding {
    const node = this.startNode<ParseNode.ImportedDefaultBinding>();
    node.ImportedBinding = this.parseBindingIdentifier();
    return this.finishNode(node, 'ImportedDefaultBinding');
  }

  // NameSpaceImport :
  //   `*` `as` ImportedBinding
  parseNameSpaceImport(): ParseNode.NameSpaceImport {
    const node = this.startNode<ParseNode.NameSpaceImport>();
    this.expect(Token.MUL);
    this.expect('as');
    node.ImportedBinding = this.parseBindingIdentifier();
    return this.finishNode(node, 'NameSpaceImport');
  }

  parseFilteredNameSpaceImport(namedImports: ParseNode.NamedImports): ParseNode.NameSpaceImport {
    const node = this.startNode<ParseNode.NameSpaceImport>();
    node.NamedImports = namedImports;
    node.ImportedBinding = this.parseBindingIdentifier();

    const names = new Set<string>();
    for (const specifier of namedImports.ImportsList) {
      if (specifier.ModuleExportName) {
        this.addEarlyError(Throw.SyntaxError('Filtered namespace imports cannot contain aliased or string import specifiers'), specifier);
      }
      const name = StringValue(specifier.ImportedBinding);
      if (names.has(name)) {
        this.addEarlyError(Throw.SyntaxError('Filtered namespace imports cannot contain duplicate names'), specifier);
      }
      names.add(name);
    }
    return this.finishNode(node, 'NameSpaceImport');
  }

  // NamedImports :
  //   `{` `}`
  //   `{` ImportsList `}`
  //   `{` ImportsList `,` `}`
  parseNamedImports(): ParseNode.NamedImports {
    const node = this.startNode<ParseNode.NamedImports>();
    const ImportsList: Mutable<ParseNode.ImportsList> = [];
    node.ImportsList = ImportsList;
    while (!this.eat(Token.RBRACE)) {
      ImportsList.push(this.parseImportSpecifier());
      if (this.eat(Token.RBRACE)) {
        break;
      }
      this.expect(Token.COMMA);
    }
    return this.finishNode(node, 'NamedImports');
  }

  // ImportSpecifier :
  //   ImportedBinding
  //   ModuleExportName `as` ImportedBinding
  parseImportSpecifier(): ParseNode.ImportSpecifier {
    const node = this.startNode<ParseNode.ImportSpecifier>();
    const name = this.parseModuleExportName();
    if (name.type === 'StringLiteral' || this.test('as')) {
      this.expect('as');
      node.ModuleExportName = name;
      node.ImportedBinding = this.parseBindingIdentifier();
    } else {
      node.ImportedBinding = this.repurpose(name, 'BindingIdentifier');
      if (isKeywordRaw(node.ImportedBinding.name)) {
        this.addEarlyError(Throw.SyntaxError('Import name cannot be a keyword'), node.ImportedBinding);
      }
      if (node.ImportedBinding.name === 'eval' || node.ImportedBinding.name === 'arguments') {
        this.addEarlyError(Throw.SyntaxError('Import name cannot be "eval" or "arguments"'), node.ImportedBinding);
      }
    }
    return this.finishNode(node, 'ImportSpecifier');
  }

  // ExportDeclaration :
  //   `export` ExportFromClause FromClause `;`
  //   `export` NamedExports `;`
  //   `export` VariableStatement
  //   `export` Declaration
  //   DecoratorList? `export` Declaration
  //   `export` `default` HoistableDeclaration
  //   DecoratorList? `export` `default` ClassDeclaration
  //   `export` `default` AssignmentExpression `;`
  //
  // ExportFromClause :
  //   `*`
  //   `*` as ModuleExportName
  //   NamedExports
  parseExportDeclaration(decoratorsBeforeExportKeyword: null | readonly ParseNode.Decorator[]): ParseNode.ExportDeclaration {
    const node = this.startNode<ParseNode.ExportDeclaration>();
    node.Decorators = decoratorsBeforeExportKeyword;
    this.expect(Token.EXPORT);
    node.default = this.eat(Token.DEFAULT);
    let isDefer = false;
    if (
      !node.default
      && surroundingAgent.feature('export-defer')
      && this.test('defer')
      && (this.testAhead(Token.MUL) || this.testAhead(Token.LBRACE))
    ) {
      this.next(); // consume `defer`
      isDefer = true;
    }
    if (node.default) {
      switch (this.peek().type) {
        case Token.FUNCTION:
          node.HoistableDeclaration = this.scope.with({ default: true }, () => this.parseFunctionDeclaration(FunctionKind.NORMAL));
          break;
        case Token.AT: {
          const decorators = this.parseDecorators();
          node.ClassDeclaration = this.scope.with({ default: true }, () => this.parseClassDeclaration(decorators));
          break;
        }
        case Token.CLASS:
          node.ClassDeclaration = this.scope.with({ default: true }, () => this.parseClassDeclaration(null));
          break;
        default:
          if (this.test('async') && this.testAhead(Token.FUNCTION) && !this.peekAhead().hadLineTerminatorBefore) {
            node.HoistableDeclaration = this.scope.with({ default: true }, () => this.parseFunctionDeclaration(FunctionKind.ASYNC));
          } else {
            node.AssignmentExpression = this.parseAssignmentExpression();
            this.semicolon();
          }
          break;
      }
      if (this.scope.exports.has('default')) {
        this.addEarlyError(Throw.SyntaxError('Default export already declared'), node);
      } else {
        this.scope.exports.add('default');
      }
    } else {
      switch (this.peek().type) {
        case Token.CONST:
          node.Declaration = this.parseLexicalDeclaration();
          this.scope.declare(node.Declaration, 'export');
          break;
        case Token.AT:
        case Token.CLASS:
          node.Declaration = this.parseClassDeclaration(null);
          this.scope.declare(node.Declaration, 'export');
          break;
        case Token.FUNCTION:
          node.Declaration = this.parseHoistableDeclaration();
          this.scope.declare(node.Declaration, 'export');
          break;
        case Token.VAR:
          node.VariableStatement = this.parseVariableStatement();
          this.scope.declare(node.VariableStatement, 'export');
          break;
        case Token.LBRACE: {
          const NamedExports = this.parseNamedExports();
          if (this.eat('as')) {
            const namespaceExportName = this.parseModuleExportName();
            (NamedExports as Mutable<ParseNode.NamedExports>).NamespaceExportName = namespaceExportName;
            this.scope.declare(namespaceExportName, 'export');
            if (!this.test('from')) {
              this.raise(Throw.SyntaxError('Filtered namespace exports must be followed by `from`'));
            }
            for (const specifier of NamedExports.ExportsList) {
              if (specifier.localName !== specifier.exportName) {
                this.addEarlyError(Throw.SyntaxError('Filtered namespace exports cannot contain aliased export specifiers'), specifier);
              }
            }
          }
          if (this.test('from')) {
            if (!NamedExports.NamespaceExportName) {
              this.scope.declare(NamedExports.ExportsList, 'export');
            }
            node.ExportFromClause = NamedExports;
            node.FromClause = this.parseFromClause();
            node.Phase = isDefer ? 'defer' : 'evaluation';
            if (this.test(Token.WITH)) {
              node.WithClause = this.parseWithClause();
            }
          } else {
            if (isDefer) {
              this.unexpected();
            }
            NamedExports.ExportsList.forEach((n) => {
              if (n.localName.type === 'StringLiteral') {
                this.addEarlyError(Throw.SyntaxError('Import name cannot be a string'), n.localName);
              }
            });
            node.NamedExports = NamedExports;
            this.scope.declare(node.NamedExports.ExportsList, 'export');
            this.scope.checkUndefinedExports(node.NamedExports);
          }
          this.semicolon();
          break;
        }
        case Token.MUL: {
          const inner = this.startNode<ParseNode.ExportFromClause>();
          this.next();
          if (this.eat('as')) {
            inner.ModuleExportName = this.parseModuleExportName();
            this.scope.declare(inner.ModuleExportName, 'export');
          } else if (isDefer) {
            this.unexpected();
          }
          node.ExportFromClause = this.finishNode(inner, 'ExportFromClause');
          node.FromClause = this.parseFromClause();
          node.Phase = isDefer ? 'defer' : 'evaluation';
          if (this.test(Token.WITH)) {
            node.WithClause = this.parseWithClause();
          }
          this.semicolon();
          break;
        }
        default:
          if (this.test('let')) {
            node.Declaration = this.parseLexicalDeclaration();
            this.scope.declare(node.Declaration, 'export');
          } else if (this.test('async') && this.testAhead(Token.FUNCTION) && !this.peekAhead().hadLineTerminatorBefore) {
            node.Declaration = this.parseHoistableDeclaration();
            this.scope.declare(node.Declaration, 'export');
          } else {
            this.unexpected();
          }
      }
    }
    return this.finishNode(node, 'ExportDeclaration');
  }

  // NamedExports :
  //   `{` `}`
  //   `{` ExportsList `}`
  //   `{` ExportsList `,` `}`
  parseNamedExports(): ParseNode.NamedExports {
    const node = this.startNode<ParseNode.NamedExports>();
    this.expect(Token.LBRACE);
    const ExportsList: Mutable<ParseNode.ExportsList> = [];
    node.ExportsList = ExportsList;
    while (!this.eat(Token.RBRACE)) {
      ExportsList.push(this.parseExportSpecifier());
      if (this.eat(Token.RBRACE)) {
        break;
      }
      this.expect(Token.COMMA);
    }
    return this.finishNode(node, 'NamedExports');
  }

  // ExportSpecifier :
  //   ModuleExportName
  //   ModuleExportName `as` ModuleExportName
  parseExportSpecifier(): ParseNode.ExportSpecifier {
    const node = this.startNode<ParseNode.ExportSpecifier>();
    node.localName = this.parseModuleExportName();
    if (this.eat('as')) {
      node.exportName = this.parseModuleExportName();
    } else {
      node.exportName = node.localName;
    }
    return this.finishNode(node, 'ExportSpecifier');
  }

  // ModuleExportName :
  //   IdentifierName
  //   StringLiteral
  parseModuleExportName(): ParseNode.ModuleExportName {
    if (this.test(Token.STRING)) {
      const literal = this.parseStringLiteral();
      if (!IsStringWellFormedUnicode(StringValue(literal))) {
        this.addEarlyError(Throw.SyntaxError('Module export name contains invalid Unicode'), literal);
      }
      return literal;
    }
    return this.parseIdentifierName();
  }

  // FromClause :
  //   `from` ModuleSpecifier
  parseFromClause(): ParseNode.FromClause {
    this.expect('from');
    return this.parseStringLiteral();
  }

  // WithClause :
  //   `with` `{` `}`
  //   `with` `{` WithEntries `,`? `}`
  parseWithClause(): ParseNode.WithClause {
    const node = this.startNode<ParseNode.WithClause>();
    this.expect(Token.WITH);
    this.expect(Token.LBRACE);

    const seenKeys = new Set<string>();

    const WithEntries = [];
    while (!this.eat(Token.RBRACE)) {
      const entry = this.parseWithEntry();

      const key = StringValue(entry.AttributeKey);
      if (seenKeys.has(key)) {
        this.addEarlyError(Throw.SyntaxError('Duplicate import attribute $1', key), entry);
      }
      seenKeys.add(key);

      WithEntries.push(entry);
      if (this.eat(Token.RBRACE)) {
        break;
      }
      this.expect(Token.COMMA);
    }
    node.WithEntries = WithEntries;

    return this.finishNode(node, 'WithClause');
  }

  parseWithEntry(): ParseNode.WithEntry {
    const node = this.startNode<ParseNode.WithEntry>();
    node.AttributeKey = this.test(Token.STRING) ? this.parseStringLiteral() : this.parseIdentifierName();
    this.expect(Token.COLON);
    node.AttributeValue = this.parseStringLiteral();
    return this.finishNode(node, 'WithEntry');
  }
}
