import type { Mutable } from '../utils/language.mts';
import { ContainsUsing } from '../static-semantics/ContainsUsing.mts';
import { Token, isAnyIdentifier, isAutomaticSemicolon } from './tokens.mts';
import { ExpressionParser } from './ExpressionParser.mts';
import { FunctionKind } from './FunctionParser.mts';
import { getDeclarations, type LabelType } from './Scope.mts';
import type { ParseNode } from './ParseNode.mts';
import { Throw } from '#self';

export abstract class StatementParser extends ExpressionParser {
  private canParseAwaitUsingDeclaration() {
    if (!this.test(Token.AWAIT) || !this.scope.hasAwait() || !this.testAhead('using')) {
      return false;
    }
    const usingToken = this.peekAhead();
    const bindingToken = this.peekAhead(2);
    if (usingToken.hadLineTerminatorBefore || bindingToken.hadLineTerminatorBefore) return false;
    return isAnyIdentifier(bindingToken.type);
  }

  eatSemicolonWithASI() {
    if (this.eat(Token.SEMICOLON)) {
      return true;
    }
    if (this.peek().hadLineTerminatorBefore || isAutomaticSemicolon(this.peek().type)) {
      return true;
    }
    return false;
  }

  semicolon() {
    if (!this.eatSemicolonWithASI()) {
      this.unexpected();
    }
  }

  // StatementList :
  //   StatementListItem
  //   StatementList StatementListItem
  /**
   * @param endToken endToken
   * @param directives directives, this array will be mutated.
   */
  parseStatementList(endToken: string | Token, directives?: string[]): ParseNode.StatementList {
    const statementList: Mutable<ParseNode.StatementList> = [];
    const oldStrict = this.state.strict;
    const directiveData = [];
    while (!this.eat(endToken)) {
      if (directives !== undefined && this.test(Token.STRING)) {
        const token = this.peek();
        const directive = this.source.slice(token.startIndex + 1, token.endIndex - 1);
        if (directive === 'use strict') {
          this.state.strict = true;
          directiveData.forEach((d) => {
            if (/\\([1-9]|0\d)/.test(d.directive)) {
              this.addEarlyError(Throw.SyntaxError('Illegal octal escape'), d.token);
            }
          });
        }
        directives.push(directive);
        directiveData.push({ directive, token });
      } else {
        directives = undefined;
      }

      const stmt = this.parseStatementListItem();
      statementList.push(stmt);
    }

    this.state.strict = oldStrict;

    return statementList;
  }

  // StatementListItem :
  //   Statement
  //   Declaration
  //
  // Declaration :
  //   HoistableDeclaration
  //   ClassDeclaration
  //   LexicalDeclaration
  parseStatementListItem(): ParseNode.StatementListItem {
    switch (this.peek().type) {
      case Token.FUNCTION:
        return this.parseHoistableDeclaration();
      case Token.AT:
      case Token.CLASS:
        return this.parseClassDeclaration(null);
      case Token.CONST:
        return this.parseLexicalDeclaration();
      default:
        if (this.test('let')) {
          switch (this.peekAhead().type) {
            case Token.LBRACE:
            case Token.LBRACK:
              return this.parseLexicalDeclaration();
            default:
              if (isAnyIdentifier(this.peekAhead().type)) return this.parseLexicalDeclaration();
              break;
          }
        }
        if (this.test('using')
            && !this.peekAhead().hadLineTerminatorBefore
            && isAnyIdentifier(this.peekAhead().type)) {
          return this.parseLexicalDeclaration();
        }
        if (this.test('async') && this.testAhead(Token.FUNCTION) && !this.peekAhead().hadLineTerminatorBefore) {
          return this.parseHoistableDeclaration();
        }
        if (this.canParseAwaitUsingDeclaration()) {
          return this.parseLexicalDeclaration();
        }
        return this.parseStatement();
    }
  }

  // HoistableDeclaration :
  //   FunctionDeclaration
  //   GeneratorDeclaration
  //   AsyncFunctionDeclaration
  //   AsyncGeneratorDeclaration
  parseHoistableDeclaration(): ParseNode.HoistableDeclaration {
    switch (this.peek().type) {
      case Token.FUNCTION:
        return this.parseFunctionDeclaration(FunctionKind.NORMAL);
      default:
        if (this.test('async') && this.testAhead(Token.FUNCTION) && !this.peekAhead().hadLineTerminatorBefore) {
          return this.parseFunctionDeclaration(FunctionKind.ASYNC);
        }
        throw new Error('unreachable');
    }
  }

  // ClassDeclaration :
  //   `class` BindingIdentifier ClassTail
  //   [+Default] `class` ClassTail
  parseClassDeclaration(decoratorsAttachedToClassDeclaration: null | readonly ParseNode.Decorator[]): ParseNode.ClassDeclaration {
    return this.parseClass(decoratorsAttachedToClassDeclaration, false) as ParseNode.ClassDeclaration;
  }

  // LexicalDeclaration :
  //   LetOrConst BindingList `;`
  //   UsingDeclaration
  //   [+Await] AwaitUsingDeclaration
  parseLexicalDeclaration(): ParseNode.LexicalDeclarationLike {
    if (this.test('using')) {
      return this.parseUsingDeclaration();
    }
    if (this.test(Token.AWAIT)) {
      return this.parseAwaitUsingDeclaration();
    }

    const node = this.startNode<ParseNode.LexicalDeclaration>();
    const letOrConst = this.eat('let') ? 'let' : this.expect(Token.CONST) && 'const';
    node.LetOrConst = letOrConst;
    node.BindingList = this.parseBindingList(true);
    this.semicolon();

    this.scope.declare(node.BindingList, 'lexical');
    node.BindingList.forEach((b) => {
      if (node.LetOrConst === 'const' && !b.Initializer) {
        this.addEarlyError(Throw.SyntaxError('Missing initializer in const declaration'), b);
      }
    });

    return this.finishNode(node, 'LexicalDeclaration');
  }

  // UsingDeclaration :
  //   `using` [no LineTerminator here] BindingList `;`
  parseUsingDeclaration(): ParseNode.UsingDeclaration {
    const node = this.startNode<ParseNode.UsingDeclaration>();
    this.expect('using');
    node.BindingList = this.parseBindingList(false);
    this.semicolon();
    this.scope.declare(node.BindingList, 'lexical');
    node.BindingList.forEach((binding) => {
      if (!binding.Initializer) {
        this.addEarlyError(Throw.SyntaxError('Missing initializer in using declaration'), binding);
      }
    });
    return this.finishNode(node, 'UsingDeclaration');
  }

  // AwaitUsingDeclaration :
  //   `await` [no LineTerminator here] `using` [no LineTerminator here] BindingList `;`
  parseAwaitUsingDeclaration(): ParseNode.AwaitUsingDeclaration {
    const node = this.startNode<ParseNode.AwaitUsingDeclaration>();
    this.expect(Token.AWAIT);
    if (this.peek().hadLineTerminatorBefore) this.unexpected();
    this.expect('using');
    if (this.peek().hadLineTerminatorBefore) this.unexpected();
    node.BindingList = this.parseBindingList(false);
    this.semicolon();
    this.scope.declare(node.BindingList, 'lexical');
    node.BindingList.forEach((binding) => {
      if (!binding.Initializer) {
        this.addEarlyError(Throw.SyntaxError('Missing initializer in await using declaration'), binding);
      }
    });
    if (!this.scope.hasReturn()) this.state.hasTopLevelAwait = true;
    return this.finishNode(node, 'AwaitUsingDeclaration');
  }

  // BindingList :
  //   LexicalBinding
  //   BindingList `,` LexicalBinding
  //
  // LexicalBinding :
  //   BindingIdentifier Initializer?
  //   [+Pattern] BindingPattern Initializer
  parseBindingList(allowPattern = true): ParseNode.BindingList {
    const bindingList: Mutable<ParseNode.BindingList> = [];
    do {
      const node = this.startNode<ParseNode.LexicalBinding>();
      if (allowPattern && (this.test(Token.LBRACE) || this.test(Token.LBRACK))) {
        node.BindingPattern = this.parseBindingPattern();
      } else {
        node.BindingIdentifier = this.parseBindingIdentifier();
      }
      node.Initializer = this.parseInitializerOpt();
      bindingList.push(this.finishNode(node, 'LexicalBinding'));
    } while (this.eat(Token.COMMA));
    return bindingList;
  }

  // BindingElement :
  //   SingleNameBinding
  //   BindingPattern Initializer?
  // SingleNameBinding :
  //   BindingIdentifier Initializer?
  parseBindingElement(): ParseNode.BindingElementLike {
    const node = this.startNode<ParseNode.BindingElementLike>();
    if (this.test(Token.LBRACE) || this.test(Token.LBRACK)) {
      node.BindingPattern = this.parseBindingPattern();
    } else {
      node.BindingIdentifier = this.parseBindingIdentifier();
    }
    node.Initializer = this.parseInitializerOpt();
    return this.finishNode(node, node.BindingPattern ? 'BindingElement' : 'SingleNameBinding');
  }

  // BindingPattern:
  //   ObjectBindingPattern
  //   ArrayBindingPattern
  parseBindingPattern(): ParseNode.BindingPattern {
    switch (this.peek().type) {
      case Token.LBRACE:
        return this.parseObjectBindingPattern();
      case Token.LBRACK:
        return this.parseArrayBindingPattern();
      default:
        return this.unexpected();
    }
  }

  // ObjectBindingPattern :
  //   `{` `}`
  //   `{` BindingRestProperty `}`
  //   `{` BindingPropertyList `}`
  //   `{` BindingPropertyList `,` BindingRestProperty? `}`
  parseObjectBindingPattern(): ParseNode.ObjectBindingPattern {
    const node = this.startNode<ParseNode.ObjectBindingPattern>();
    this.expect(Token.LBRACE);
    const BindingPropertyList: Mutable<ParseNode.BindingPropertyList> = [];
    node.BindingPropertyList = BindingPropertyList;
    while (!this.eat(Token.RBRACE)) {
      if (this.test(Token.ELLIPSIS)) {
        node.BindingRestProperty = this.parseBindingRestProperty();
        this.expect(Token.RBRACE);
        break;
      } else {
        BindingPropertyList.push(this.parseBindingProperty());
        if (!this.eat(Token.COMMA)) {
          this.expect(Token.RBRACE);
          break;
        }
      }
    }
    return this.finishNode(node, 'ObjectBindingPattern');
  }

  // BindingProperty :
  //   SingleNameBinding
  //   PropertyName : BindingElement
  parseBindingProperty(): ParseNode.BindingPropertyLike {
    const node = this.startNode<ParseNode.BindingProperty | ParseNode.SingleNameBinding>();
    const name = this.parsePropertyName();
    if (this.eat(Token.COLON)) {
      node.PropertyName = name;
      node.BindingElement = this.parseBindingElement();
      return this.finishNode(node, 'BindingProperty');
    } else {
      if (name.type !== 'IdentifierName') {
        this.unexpected(name);
      }
      this.validateIdentifierReference(name.name, node);
    }
    node.BindingIdentifier = this.repurpose(name, 'BindingIdentifier');
    node.Initializer = this.parseInitializerOpt();
    return this.finishNode(node, 'SingleNameBinding');
  }

  // BindingRestProperty :
  //  `...` BindingIdentifier
  parseBindingRestProperty(): ParseNode.BindingRestProperty {
    const node = this.startNode<ParseNode.BindingRestProperty>();
    this.expect(Token.ELLIPSIS);
    node.BindingIdentifier = this.parseBindingIdentifier();
    return this.finishNode(node, 'BindingRestProperty');
  }

  // ArrayBindingPattern :
  //   `[` Elision? BindingRestElement `]`
  //   `[` BindingElementList `]`
  //   `[` BindingElementList `,` Elision? BindingRestElement `]`
  parseArrayBindingPattern(): ParseNode.ArrayBindingPattern {
    const node = this.startNode<ParseNode.ArrayBindingPattern>();
    this.expect(Token.LBRACK);
    const BindingElementList: Mutable<ParseNode.BindingElementList> = [];
    node.BindingElementList = BindingElementList;
    while (true) {
      while (this.test(Token.COMMA)) {
        const elision = this.startNode<ParseNode.Elision>();
        this.next();
        BindingElementList.push(this.finishNode(elision, 'Elision'));
      }
      if (this.eat(Token.RBRACK)) {
        break;
      }
      if (this.test(Token.ELLIPSIS)) {
        node.BindingRestElement = this.parseBindingRestElement();
        this.expect(Token.RBRACK);
        break;
      } else {
        BindingElementList.push(this.parseBindingElement());
      }
      if (this.eat(Token.RBRACK)) {
        break;
      }
      this.expect(Token.COMMA);
    }
    return this.finishNode(node, 'ArrayBindingPattern');
  }

  // BindingRestElement :
  //   `...` BindingIdentifier
  //   `...` BindingPattern
  parseBindingRestElement(): ParseNode.BindingRestElement {
    const node = this.startNode<ParseNode.BindingRestElement>();
    this.expect(Token.ELLIPSIS);
    switch (this.peek().type) {
      case Token.LBRACE:
      case Token.LBRACK:
        node.BindingPattern = this.parseBindingPattern();
        break;
      default:
        node.BindingIdentifier = this.parseBindingIdentifier();
        break;
    }
    return this.finishNode(node, 'BindingRestElement');
  }

  // Initializer : `=` AssignmentExpression
  parseInitializerOpt(): ParseNode.Initializer | null {
    if (this.eat(Token.ASSIGN)) {
      return this.parseAssignmentExpression();
    }
    return null;
  }

  // FunctionDeclaration
  parseFunctionDeclaration(kind: FunctionKind): ParseNode.FunctionDeclarationLike {
    return this.parseFunction(false, kind) as ParseNode.FunctionDeclarationLike;
  }

  // Statement :
  //   ...
  parseStatement(): ParseNode.Statement {
    switch (this.peek().type) {
      case Token.LBRACE:
        return this.parseBlockStatement();
      case Token.VAR:
        return this.parseVariableStatement();
      case Token.SEMICOLON: {
        const node = this.startNode<ParseNode.EmptyStatement>();
        this.next();
        return this.finishNode(node, 'EmptyStatement');
      }
      case Token.IF:
        return this.parseIfStatement();
      case Token.DO:
        return this.parseDoWhileStatement();
      case Token.WHILE:
        return this.parseWhileStatement();
      case Token.FOR:
        return this.parseForStatement();
      case Token.SWITCH:
        return this.parseSwitchStatement();
      case Token.CONTINUE:
      case Token.BREAK:
        return this.parseBreakContinueStatement();
      case Token.RETURN:
        return this.parseReturnStatement();
      case Token.WITH:
        return this.parseWithStatement();
      case Token.THROW:
        return this.parseThrowStatement();
      case Token.TRY:
        return this.parseTryStatement();
      case Token.DEBUGGER:
        return this.parseDebuggerStatement();
      default:
        return this.parseExpressionStatement();
    }
  }

  // BlockStatement : Block
  parseBlockStatement(): ParseNode.BlockStatement {
    return this.parseBlock();
  }

  // Block : `{` StatementList `}`
  parseBlock(lexical = true): ParseNode.Block {
    const node = this.startNode<ParseNode.Block>();
    this.expect(Token.LBRACE);
    node.StatementList = this.scope.with({ lexical }, () => this.parseStatementList(Token.RBRACE));
    return this.finishNode(node, 'Block');
  }

  // VariableStatement : `var` VariableDeclarationList `;`
  parseVariableStatement(): ParseNode.VariableStatement {
    const node = this.startNode<ParseNode.VariableStatement>();
    this.expect(Token.VAR);
    node.VariableDeclarationList = this.parseVariableDeclarationList();
    this.semicolon();
    this.scope.declare(node.VariableDeclarationList, 'variable');
    return this.finishNode(node, 'VariableStatement');
  }

  // VariableDeclarationList :
  //   VariableDeclaration
  //   VariableDeclarationList `,` VariableDeclaration
  parseVariableDeclarationList(firstDeclarationRequiresInit = true): ParseNode.VariableDeclarationList {
    const declarationList: Mutable<ParseNode.VariableDeclarationList> = [];
    do {
      const node = this.parseVariableDeclaration(firstDeclarationRequiresInit);
      declarationList.push(node);
    } while (this.eat(Token.COMMA));
    return declarationList;
  }

  // VariableDeclaration :
  //   BindingIdentifier Initializer?
  //   BindingPattern Initializer
  parseVariableDeclaration(firstDeclarationRequiresInit: boolean): ParseNode.VariableDeclaration {
    const node = this.startNode<ParseNode.VariableDeclaration>();
    switch (this.peek().type) {
      case Token.LBRACE:
      case Token.LBRACK:
        node.BindingPattern = this.parseBindingPattern();
        if (firstDeclarationRequiresInit) {
          this.expect(Token.ASSIGN);
          node.Initializer = this.parseAssignmentExpression();
        } else {
          node.Initializer = this.parseInitializerOpt();
        }
        break;
      default:
        node.BindingIdentifier = this.parseBindingIdentifier();
        node.Initializer = this.parseInitializerOpt();
        break;
    }
    return this.finishNode(node, 'VariableDeclaration');
  }

  // IfStatement :
  //  `if` `(` Expression `)` Statement `else` Statement
  //  `if` `(` Expression `)` Statement [lookahead != `else`]
  parseIfStatement(): ParseNode.IfStatement {
    const node = this.startNode<ParseNode.IfStatement>();
    this.expect(Token.IF);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    node.Statement_a = this.parseStatement();
    if (this.eat(Token.ELSE)) {
      node.Statement_b = this.parseStatement();
    }
    return this.finishNode(node, 'IfStatement');
  }

  // `while` `(` Expression `)` Statement
  parseWhileStatement(): ParseNode.WhileStatement {
    const node = this.startNode<ParseNode.WhileStatement>();
    this.expect(Token.WHILE);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    this.scope.with({ label: 'loop' }, () => {
      node.Statement = this.parseStatement();
    });
    return this.finishNode(node, 'WhileStatement');
  }

  // `do` Statement `while` `(` Expression `)` `;`
  parseDoWhileStatement(): ParseNode.DoWhileStatement {
    const node = this.startNode<ParseNode.DoWhileStatement>();
    this.expect(Token.DO);
    node.Statement = this.scope.with({ label: 'loop' }, () => this.parseStatement());
    this.expect(Token.WHILE);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    // Semicolons are completely optional after a do-while, even without a newline
    this.eat(Token.SEMICOLON);
    return this.finishNode(node, 'DoWhileStatement');
  }

  // ForStatement :
  //   `for` `(` [lookahead != `let` `[`] Expression? `;` Expression? `;` Expression? `)` Statement
  //   `for` `(` `var` VariableDeclarationList `;` Expression? `;` Expression? `)` Statement
  //   `for` `(` LexicalDeclaration Expression? `;` Expression? `)` Statement
  //
  // ForInOfStatement :
  //   `for` `(` [lookahead != `let` `[`] LeftHandSideExpression `in` Expression `)` Statement
  //   `for` `(` `var` ForBinding `in` Expression `)` Statement
  //   `for` `(` ForDeclaration `in` Expression `)` Statement
  //   `for` `(` [lookahead not in { `let`, `async` `of` }] LeftHandSideExpression `of` AssignmentExpression `)` Statement
  //   `for` `(` `var` ForBinding `of` AssignmentExpression `)` Statement
  //   `for` `(` [lookahead != `using` `of`] ForDeclaration `of` AssignmentExpression `)` Statement
  //   [+Await] `for` `await` `(` [lookahead != `let`] LeftHandSideExpression `of` AssignmentExpression `)` Statement
  //   [+Await] `for` `await` `(` `var` ForBinding `of` AssignmentExpression `)` Statement
  //   [+Await] `for` `await` `(` [lookahead != `using` `of`] ForDeclaration `of` AssignmentExpression `)` Statement
  //
  // ForDeclaration :
  //   LetOrConst ForBinding
  //   [+Using] `using` [no LineTerminator here] ForBinding
  //   [+Using, +Await] `await` [no LineTerminator here] `using`
  //     [no LineTerminator here] ForBinding
  protected finishForDeclaration(
    node: ParseNode.Unfinished<ParseNode.LexicalDeclarationLike | ParseNode.ForDeclaration>,
    binding: ParseNode.LexicalBinding,
    production: ParseNode.ForDeclaration['production'],
  ): ParseNode.ForDeclaration {
    if (production !== 'LetOrConst' && !this.test('of')) {
      // example:
      // for (using resource in object) {}
      this.raise(Throw.SyntaxError('Using declarations are only allowed in for-of loop heads'), node);
    }
    node.ForBinding = this.repurpose(binding, 'ForBinding', (_, oldNode) => {
      if (oldNode.Initializer) {
        this.raise(Throw.SyntaxError('Initializers are not allowed in for-in/of loop declarations'), oldNode.Initializer);
      }
    });
    node.production = production;
    const declaration = this.finishNode(node, 'ForDeclaration');
    getDeclarations(declaration).forEach(({ name, node: bindingNode }) => {
      if (name === 'let') {
        // example:
        // for (using let of resources) {}
        this.addEarlyError(Throw.SyntaxError('For-in/of loop declarations cannot bind "let"'), bindingNode);
      }
    });
    return declaration;
  }

  // Parses `Expression? ; Expression? ) Statement` after the first `;` of a ForStatement.
  private parseForStatementTail() {
    const test = this.test(Token.SEMICOLON) ? undefined : this.parseExpression();
    this.expect(Token.SEMICOLON);
    const update = this.test(Token.RPAREN) ? undefined : this.parseExpression();
    this.expect(Token.RPAREN);
    const statement = this.parseStatement();
    return { test, update, statement };
  }

  private parseForInStatementTail(
    node: ParseNode.Unfinished<ParseNode.ForStatement | ParseNode.ForInOfStatement>,
  ): ParseNode.ForInStatement {
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    node.Statement = this.parseStatement();
    return this.finishNode(node, 'ForInStatement');
  }

  private parseForOfStatementTail(
    node: ParseNode.Unfinished<ParseNode.ForStatement | ParseNode.ForInOfStatement>,
    isAwait: boolean,
  ): ParseNode.ForOfStatement | ParseNode.ForAwaitStatement {
    node.AssignmentExpression = this.parseAssignmentExpression();
    this.expect(Token.RPAREN);
    node.Statement = this.parseStatement();
    return this.finishNode(node, isAwait ? 'ForAwaitStatement' : 'ForOfStatement');
  }

  parseForStatement(): ParseNode.ForStatement | ParseNode.ForInOfStatement {
    return this.scope.with({
      lexical: true,
      label: 'loop',
    }, () => {
      const node = this.startNode<ParseNode.ForStatement | ParseNode.ForInOfStatement>();
      this.expect(Token.FOR);
      const isAwait = this.scope.hasAwait() && this.eat(Token.AWAIT);
      if (isAwait && !this.scope.hasReturn()) {
        this.state.hasTopLevelAwait = true;
      }
      this.expect(Token.LPAREN);
      if (isAwait && this.test(Token.SEMICOLON)) {
        // for await ( ; ...; ...)
        this.raise(Throw.SyntaxError('For-await syntax is only valid with for-of loops'));
      }
      // for ( ; ... ; ... )
      if (this.eat(Token.SEMICOLON)) {
        const tail = this.parseForStatementTail();
        if (tail.test) node.Expression_b = tail.test;
        if (tail.update) node.Expression_c = tail.update;
        node.Statement = tail.statement;
        return this.finishNode(node, 'ForStatement');
      }
      const isLexicalBindingStart = () => {
        switch (this.peekAhead().type) {
          case Token.LBRACE:
          case Token.LBRACK:
            return true;
          default:
            return isAnyIdentifier(this.peekAhead().type);
        }
      };
      let isUsingDeclaration = false;
      // for (using ...
      if (this.test('using')) {
        // for (using [no LineTerminator here] ...
        if (!this.peekAhead().hadLineTerminatorBefore) {
          // for (using of ...
          if (this.testAhead('of')) {
            switch (this.peekAhead(2).type) {
              // for (using of = ...
              case Token.ASSIGN:
              // for (using of,
              // for (using of;
              // this branch is for better error message
              // for code:
              // for (using of, ident2 = expr; condition; update)
              // for (using of; condition; update)
              case Token.COMMA:
              case Token.SEMICOLON:
                isUsingDeclaration = true;
                break;
              default:
                // example: (using is a variable here)
                // let using;
                // for (using of resources) {}
                // for (using of [resource1, resource2]) {}
                // for (using of "abc") {}
                isUsingDeclaration = false;
                break;
            }
          } else {
            // for (using ident ...
            isUsingDeclaration = isAnyIdentifier(this.peekAhead().type);
          }
        }
      }
      const isAwaitUsingDeclaration = this.canParseAwaitUsingDeclaration();
      if (isUsingDeclaration || isAwaitUsingDeclaration) {
        const inner = this.startNode<
          ParseNode.UsingDeclaration
          | ParseNode.AwaitUsingDeclaration
          | ParseNode.ForDeclaration_Using
          | ParseNode.ForDeclaration_AwaitUsing
        >();
        if (isAwaitUsingDeclaration) {
          this.expect(Token.AWAIT);
          if (this.peek().hadLineTerminatorBefore) this.unexpected();
          this.expect('using');
          if (this.peek().hadLineTerminatorBefore) this.unexpected();
          if (!this.scope.hasReturn()) this.state.hasTopLevelAwait = true;
        } else {
          this.expect('using');
        }
        // here we parsed at `for (using = expr()`
        //                              ^ here
        const list = this.parseBindingList(false);
        this.scope.declare(list, 'lexical');

        // for (using ident1 = expr; condition; update) {}
        const isTraditionalFor = list.length > 1 || this.test(Token.SEMICOLON) || !!list[0]!.Initializer;
        if (isTraditionalFor) {
          if (isAwait) this.raise(Throw.SyntaxError('For-await syntax is only valid with for-of loops'));
          list.forEach((binding) => {
            if (!binding.Initializer) {
              const error = isAwaitUsingDeclaration
                ? Throw.SyntaxError('Missing initializer in await using declaration')
                : Throw.SyntaxError('Missing initializer in using declaration');
              this.addEarlyError(error, binding);
            }
          });
          inner.BindingList = list;
          node.LexicalDeclaration = this.finishNode(
            inner,
            isAwaitUsingDeclaration ? 'AwaitUsingDeclaration' : 'UsingDeclaration',
          );
          this.expect(Token.SEMICOLON);
          const tail = this.parseForStatementTail();
          if (tail.test) node.Expression_a = tail.test;
          if (tail.update) node.Expression_b = tail.update;
          node.Statement = tail.statement;
          return this.finishNode(node, 'ForStatement');
        }
        // for (using ident in expr) {}
        //                  ^ invalid!
        node.ForDeclaration = this.finishForDeclaration(
          inner,
          list[0]!,
          isAwaitUsingDeclaration ? 'AwaitUsing' : 'Using',
        );
        this.expect('of');
        return this.parseForOfStatementTail(node, isAwait);
      }
      // for (let/const [
      // for (let/const {
      // for (let/const ident
      if ((this.test('let') || this.test(Token.CONST)) && isLexicalBindingStart()) {
        const inner = this.startNode<ParseNode.LexicalDeclaration | ParseNode.ForDeclaration_LetOrConst>();
        if (this.eat('let')) {
          inner.LetOrConst = 'let';
        } else {
          this.expect(Token.CONST);
          inner.LetOrConst = 'const';
        }
        const list = this.parseBindingList();
        this.scope.declare(list, 'lexical');
        if (list.length > 1 || this.test(Token.SEMICOLON)) {
          if (isAwait) {
            this.raise(Throw.SyntaxError('For-await syntax is only valid with for-of loops'));
          }
          if (inner.LetOrConst === 'const') {
            list.forEach((b) => {
              if (!b.Initializer) {
                this.addEarlyError(Throw.SyntaxError('Missing initializer in const declaration'), b);
              }
            });
          }
          inner.BindingList = list;
          node.LexicalDeclaration = this.finishNode(inner, 'LexicalDeclaration');
          this.expect(Token.SEMICOLON);
          const tail = this.parseForStatementTail();
          if (tail.test) node.Expression_a = tail.test;
          if (tail.update) node.Expression_b = tail.update;
          node.Statement = tail.statement;
          return this.finishNode(node, 'ForStatement');
        }
        node.ForDeclaration = this.finishForDeclaration(inner, list[0], 'LetOrConst');
        // for (const x in ...
        if (!isAwait && this.eat(Token.IN)) {
          return this.parseForInStatementTail(node);
        }
        // for (const x of ...
        this.expect('of');
        return this.parseForOfStatementTail(node, isAwait);
      }

      // for (var ...
      if (this.eat(Token.VAR)) {
        if (isAwait) {
          node.ForBinding = this.parseForBinding();
          this.expect('of');
          return this.parseForOfStatementTail(node, true);
        }
        const list = this.parseVariableDeclarationList(false);
        if (list.length > 1 || this.test(Token.SEMICOLON)) {
          node.VariableDeclarationList = list;
          this.expect(Token.SEMICOLON);
          const tail = this.parseForStatementTail();
          if (tail.test) node.Expression_a = tail.test;
          if (tail.update) node.Expression_b = tail.update;
          node.Statement = tail.statement;
          return this.finishNode(node, 'ForStatement');
        }
        node.ForBinding = this.repurpose(list[0], 'ForBinding', (_, oldNode) => {
          if (oldNode.Initializer) {
            this.raise(Throw.SyntaxError('Initializers are not allowed in for-in/of loop declarations'), oldNode.Initializer);
          }
        });
        if (this.eat('of')) {
          return this.parseForOfStatementTail(node, false);
        } else {
          this.expect(Token.IN);
          return this.parseForInStatementTail(node);
        }
      }

      // for (some_lhs_to_update ...
      this.scope.pushAssignmentInfo('for');
      const expression = this.scope.with({ in: false }, () => this.parseExpression());
      const validateLHS = (n: ParseNode) => {
        if (n.type === 'AssignmentExpression') {
          this.addEarlyError(Throw.SyntaxError('Invalid left-hand side in for-in/of statement'), n);
        } else {
          this.validateAssignmentTarget(n);
        }
      };
      const assignmentInfo = this.scope.popAssignmentInfo();
      if (!isAwait && this.eat(Token.IN)) {
        assignmentInfo.clear();
        validateLHS(expression);
        node.LeftHandSideExpression = expression as ParseNode.LeftHandSideExpression; // NOTE: unsound cast
        return this.parseForInStatementTail(node);
      }
      const isExactlyAsync = expression.type === 'IdentifierReference'
        && !expression.escaped
        && expression.name === 'async';
      // `for (value of values) {}`
      // `for (\u0061sync of values) {}`
      // `for await (async of values) {}`
      // but not `for (async of values) {}`, which is excluded by the lookahead restriction.
      if ((!isExactlyAsync || isAwait) && this.eat('of')) {
        assignmentInfo.clear();
        validateLHS(expression);
        node.LeftHandSideExpression = expression as ParseNode.LeftHandSideExpression; // NOTE: unsound cast
        return this.parseForOfStatementTail(node, isAwait);
      }

      if (isAwait) {
        this.raise(Throw.SyntaxError('For-await syntax is only valid with for-of loops'));
      }

      node.Expression_a = expression;
      this.expect(Token.SEMICOLON);
      const tail = this.parseForStatementTail();
      if (tail.test) node.Expression_b = tail.test;
      if (tail.update) node.Expression_c = tail.update;
      node.Statement = tail.statement;
      return this.finishNode(node, 'ForStatement');
    });
  }

  // ForBinding :
  //   BindingIdentifier
  //   [+Pattern] BindingPattern
  parseForBinding(): ParseNode.ForBinding {
    const node = this.startNode<ParseNode.ForBinding>();
    switch (this.peek().type) {
      case Token.LBRACE:
      case Token.LBRACK:
        node.BindingPattern = this.parseBindingPattern();
        break;
      default:
        node.BindingIdentifier = this.parseBindingIdentifier();
        break;
    }
    return this.finishNode(node, 'ForBinding');
  }


  // SwitchStatement :
  //   `switch` `(` Expression `)` CaseBlock
  parseSwitchStatement(): ParseNode.SwitchStatement {
    const node = this.startNode<ParseNode.SwitchStatement>();
    this.expect(Token.SWITCH);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    this.scope.with({
      lexical: true,
      label: 'switch',
    }, () => {
      node.CaseBlock = this.parseCaseBlock();
    });
    return this.finishNode(node, 'SwitchStatement');
  }

  // CaseBlock :
  //   `{` CaseClauses? `}`
  //   `{` CaseClauses? DefaultClause CaseClauses? `}`
  // CaseClauses :
  //   CaseClause
  //   CaseClauses CauseClause
  // CaseClause :
  //   `case` Expression `:` StatementList?
  // DefaultClause :
  //   `default` `:` StatementList?
  parseCaseBlock(): ParseNode.CaseBlock {
    const node = this.startNode<ParseNode.CaseBlock>();
    let CaseClauses_a: Mutable<ParseNode.CaseClauses> | undefined;
    let CaseClauses_b: Mutable<ParseNode.CaseClauses> | undefined;
    this.expect(Token.LBRACE);
    while (!this.eat(Token.RBRACE)) {
      switch (this.peek().type) {
        case Token.CASE:
        case Token.DEFAULT: {
          const inner = this.startNode<ParseNode.CaseClause | ParseNode.DefaultClause>();
          const t = this.next().type;
          if (t === Token.DEFAULT && node.DefaultClause) {
            this.unexpected();
          }
          if (t === Token.CASE) {
            inner.Expression = this.parseExpression();
          }
          this.expect(Token.COLON);
          let StatementList: Mutable<ParseNode.StatementList> | undefined;
          while (!(this.test(Token.CASE) || this.test(Token.DEFAULT) || this.test(Token.RBRACE))) {
            if (!StatementList) {
              StatementList = [];
              inner.StatementList = StatementList;
            }
            const statement = this.parseStatementListItem();
            StatementList.push(statement);
          }
          if (StatementList && ContainsUsing(StatementList)) {
            this.addEarlyError(Throw.SyntaxError('Using declarations are not allowed directly in switch clauses'), inner);
          }
          if (t === Token.DEFAULT) {
            node.DefaultClause = this.finishNode(inner, 'DefaultClause');
          } else {
            if (node.DefaultClause) {
              if (!CaseClauses_b) {
                CaseClauses_b = [];
                node.CaseClauses_b = CaseClauses_b;
              }
              CaseClauses_b.push(this.finishNode(inner, 'CaseClause'));
            } else {
              if (!CaseClauses_a) {
                CaseClauses_a = [];
                node.CaseClauses_a = CaseClauses_a;
              }
              CaseClauses_a.push(this.finishNode(inner, 'CaseClause'));
            }
          }
          break;
        }
        default:
          this.unexpected();
      }
    }
    return this.finishNode(node, 'CaseBlock');
  }

  // BreakStatement :
  //   `break` `;`
  //   `break` [no LineTerminator here] LabelIdentifier `;`
  //
  // ContinueStatement :
  //   `continue` `;`
  //   `continue` [no LineTerminator here] LabelIdentifier `;`
  parseBreakContinueStatement(): ParseNode.BreakStatement | ParseNode.ContinueStatement {
    const node = this.startNode<ParseNode.BreakStatement | ParseNode.ContinueStatement>();
    const isBreak = this.eat(Token.BREAK);
    if (!isBreak) {
      this.expect(Token.CONTINUE);
    }
    if (this.eat(Token.SEMICOLON)) {
      node.LabelIdentifier = null;
    } else if (this.peek().hadLineTerminatorBefore) {
      node.LabelIdentifier = null;
      this.semicolon();
    } else {
      if (this.test(Token.IDENTIFIER)) {
        node.LabelIdentifier = this.parseLabelIdentifier();
      } else {
        node.LabelIdentifier = null;
      }
      this.semicolon();
    }
    this.verifyBreakContinue(node, isBreak);
    return this.finishNode(node, isBreak ? 'BreakStatement' : 'ContinueStatement');
  }

  verifyBreakContinue(node: ParseNode.Unfinished<ParseNode.BreakStatement | ParseNode.ContinueStatement>, isBreak: boolean) {
    let i = 0;
    for (; i < this.scope.labels.length; i += 1) {
      const label = this.scope.labels[i];
      if (!node.LabelIdentifier || node.LabelIdentifier.name === label.name) {
        if (label.type && (isBreak || label.type === 'loop')) {
          break;
        }
        if (node.LabelIdentifier && isBreak) {
          break;
        }
      }
    }
    if (i === this.scope.labels.length) {
      this.addEarlyError(Throw.SyntaxError('Label $1 not found', node.LabelIdentifier?.name ?? ''), node.LabelIdentifier || node);
    }
  }

  // ReturnStatement :
  //   `return` `;`
  //   `return` [no LineTerminator here] Expression `;`
  parseReturnStatement(): ParseNode.ReturnStatement {
    if (!this.scope.hasReturn()) {
      this.unexpected();
    }
    const node = this.startNode<ParseNode.ReturnStatement>();
    this.expect(Token.RETURN);
    if (this.eatSemicolonWithASI()) {
      node.Expression = null;
    } else {
      node.Expression = this.parseExpression();
      this.semicolon();
    }
    return this.finishNode(node, 'ReturnStatement');
  }

  // WithStatement :
  //   `with` `(` Expression `)` Statement
  parseWithStatement(): ParseNode.WithStatement {
    if (this.isStrictMode()) {
      this.addEarlyError(Throw.SyntaxError('with statement cannot be used in strict mode'));
    }
    const node = this.startNode<ParseNode.WithStatement>();
    this.expect(Token.WITH);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    node.Statement = this.parseStatement();
    return this.finishNode(node, 'WithStatement');
  }

  // ThrowStatement :
  //   `throw` [no LineTerminator here] Expression `;`
  parseThrowStatement(): ParseNode.ThrowStatement {
    const node = this.startNode<ParseNode.ThrowStatement>();
    this.expect(Token.THROW);
    if (this.peek().hadLineTerminatorBefore) {
      this.raise(Throw.SyntaxError('Newline after throw statement'), node);
    }
    node.Expression = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, 'ThrowStatement');
  }

  // TryStatement :
  //   `try` Block Catch
  //   `try` Block Finally
  //   `try` Block Catch Finally
  //
  // Catch :
  //   `catch` `(` CatchParameter `)` Block
  //   `catch` Block
  //
  // Finally :
  //   `finally` Block
  //
  // CatchParameter :
  //   BindingIdentifier
  //   BindingPattern
  parseTryStatement(): ParseNode.TryStatement {
    const node = this.startNode<ParseNode.TryStatement>();
    this.expect(Token.TRY);
    node.Block = this.parseBlock();
    if (this.eat(Token.CATCH)) {
      this.scope.with({ lexical: true }, () => {
        const clause = this.startNode<ParseNode.Catch>();
        if (this.eat(Token.LPAREN)) {
          switch (this.peek().type) {
            case Token.LBRACE:
            case Token.LBRACK:
              clause.CatchParameter = this.parseBindingPattern();
              break;
            default:
              clause.CatchParameter = this.parseBindingIdentifier();
              break;
          }
          this.scope.declare(clause.CatchParameter, 'lexical-allow-let');
          this.expect(Token.RPAREN);
        } else {
          clause.CatchParameter = null;
        }
        clause.Block = this.parseBlock(false);
        node.Catch = this.finishNode(clause, 'Catch');
      });
    } else {
      node.Catch = null;
    }
    if (this.eat(Token.FINALLY)) {
      node.Finally = this.parseBlock();
    } else {
      node.Finally = null;
    }
    if (!node.Catch && !node.Finally) {
      this.raise(Throw.SyntaxError('Missing catch or finally clause in try statement'));
    }
    return this.finishNode(node, 'TryStatement');
  }

  // DebuggerStatement : `debugger` `;`
  parseDebuggerStatement(): ParseNode.DebuggerStatement {
    const node = this.startNode<ParseNode.DebuggerStatement>();
    this.expect(Token.DEBUGGER);
    this.semicolon();
    return this.finishNode(node, 'DebuggerStatement');
  }

  // ExpressionStatement :
  //   [lookahead != `{`, `function`, `async` [no LineTerminator here] `function`, `class`, `let` `[` ] Expression `;`
  parseExpressionStatement(): ParseNode.ExpressionStatement | ParseNode.LabelledStatement {
    switch (this.peek().type) {
      case Token.LBRACE:
      case Token.FUNCTION:
      case Token.CLASS:
        this.unexpected();
        break;
      default:
        if (this.test('async') && this.testAhead(Token.FUNCTION) && !this.peekAhead().hadLineTerminatorBefore) {
          this.unexpected();
        }
        if (this.test('let') && this.testAhead(Token.LBRACK)) {
          this.unexpected();
        }
        break;
    }
    const startToken = this.peek();
    const node = this.startNode<ParseNode.ExpressionStatement | ParseNode.LabelledStatement>();
    const expression = this.parseExpression();
    if (expression.type === 'IdentifierReference' && this.eat(Token.COLON)) {
      const LabelIdentifier = this.repurpose(expression, 'LabelIdentifier');
      node.LabelIdentifier = LabelIdentifier;

      if (this.scope.labels.find((l) => l.name === LabelIdentifier.name)) {
        this.addEarlyError(Throw.SyntaxError('$1 is already declared', node.LabelIdentifier.name), node.LabelIdentifier);
      }
      let type: LabelType | null = null;
      switch (this.peek().type) {
        case Token.SWITCH:
          type = 'switch';
          break;
        case Token.DO:
        case Token.WHILE:
        case Token.FOR:
          type = 'loop';
          break;
        default:
          break;
      }
      if (type !== null && this.scope.labels.length > 0) {
        const last = this.scope.labels[this.scope.labels.length - 1];
        if (last.nextToken === startToken) {
          last.type = type;
        }
      }
      this.scope.labels.push({
        name: node.LabelIdentifier.name,
        type,
        nextToken: type === null ? this.peek() : null,
      });

      node.LabelledItem = this.parseStatement();

      this.scope.labels.pop();

      return this.finishNode(node, 'LabelledStatement');
    }
    node.Expression = expression;
    this.semicolon();
    return this.finishNode(node, 'ExpressionStatement');
  }
}
