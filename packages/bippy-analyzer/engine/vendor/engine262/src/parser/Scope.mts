import {
  Assert, Parser, Throw, type ErrorObject,
} from '../index.mts';
import { isArray, OutOfRange } from '../utils/language.mts';
import type { TokenData } from './Lexer.mts';
import type { ParseNode } from './ParseNode.mts';

export enum Flag {
  return = 1 << 0,
  await = 1 << 1,
  yield = 1 << 2,
  parameters = 1 << 3,
  newTarget = 1 << 4,
  importMeta = 1 << 5,
  superCall = 1 << 6,
  superProperty = 1 << 7,
  in = 1 << 8,
  default = 1 << 9,
  module = 1 << 10,
  classStaticBlock = 1 << 11,
}

export interface DeclarationInfo {
  readonly name: string;
  readonly node: ParseNode;
}

export function getDeclarations(node: ParseNode | readonly ParseNode[]): DeclarationInfo[] {
  if (isArray(node)) {
    return node.flatMap((n) => getDeclarations(n));
  }
  switch (node.type) {
    case 'LexicalBinding':
    case 'VariableDeclaration':
    case 'BindingRestElement':
    case 'ForBinding':
      if (node.BindingIdentifier) {
        return getDeclarations(node.BindingIdentifier);
      }
      if (node.BindingPattern) {
        return getDeclarations(node.BindingPattern);
      }
      return [];
    case 'BindingRestProperty':
      if (node.BindingIdentifier) {
        return getDeclarations(node.BindingIdentifier);
      }
      return [];
    case 'SingleNameBinding':
      return getDeclarations(node.BindingIdentifier);
    case 'ImportClause': {
      const d = [];
      if (node.ImportedDefaultBinding) {
        d.push(...getDeclarations(node.ImportedDefaultBinding));
      }
      if (node.NameSpaceImport) {
        d.push(...getDeclarations(node.NameSpaceImport));
      }
      if (node.NamedImports) {
        d.push(...getDeclarations(node.NamedImports));
      }
      return d;
    }
    case 'ImportSpecifier':
      return getDeclarations(node.ImportedBinding);
    case 'ImportedDefaultBinding':
    case 'NameSpaceImport':
      return getDeclarations(node.ImportedBinding);
    case 'NamedImports':
      return getDeclarations(node.ImportsList);
    case 'ObjectBindingPattern': {
      const declarations = getDeclarations(node.BindingPropertyList);
      if (node.BindingRestProperty) {
        declarations.push(...getDeclarations(node.BindingRestProperty));
      }
      return declarations;
    }
    case 'ArrayBindingPattern': {
      const declarations = getDeclarations(node.BindingElementList);
      if (node.BindingRestElement) {
        declarations.push(...getDeclarations(node.BindingRestElement));
      }
      return declarations;
    }
    case 'BindingElement':
      return getDeclarations(node.BindingPattern);
    case 'BindingProperty':
      return getDeclarations(node.BindingElement);
    case 'BindingIdentifier':
    case 'IdentifierName':
    case 'LabelIdentifier':
      return [{ name: node.name, node }];
    case 'PrivateIdentifier':
      return [{ name: `#${node.name}`, node }];
    case 'StringLiteral':
      return [{ name: node.value, node }];
    case 'Elision':
      return [];
    case 'ForDeclaration':
      return getDeclarations(node.ForBinding);
    case 'ExportSpecifier':
      return getDeclarations(node.exportName);
    case 'FunctionDeclaration':
    case 'GeneratorDeclaration':
    case 'AsyncFunctionDeclaration':
    case 'AsyncGeneratorDeclaration':
      Assert(!!node.BindingIdentifier);
      return getDeclarations(node.BindingIdentifier);
    case 'LexicalDeclaration':
    case 'UsingDeclaration':
    case 'AwaitUsingDeclaration':
      return getDeclarations(node.BindingList);
    case 'VariableStatement':
      return getDeclarations(node.VariableDeclarationList);
    case 'ClassDeclaration':
      Assert(!!node.BindingIdentifier);
      return getDeclarations(node.BindingIdentifier);
    default:
      throw OutOfRange.nonExhaustive(node);
  }
}

export type ScopeFlagSetters =
  & { readonly [P in (keyof typeof Flag) & string]?: boolean; }
  & {
    readonly lexical?: boolean;
    readonly variable?: boolean;
    readonly variableFunctions?: boolean;
    readonly private?: boolean;
    readonly label?: LabelType | 'boundary';
    readonly strict?: boolean;
  };

export interface ScopeInfo {
  readonly flags: ScopeFlagSetters;
  readonly lexicals: Set<string>;
  readonly variables: Set<string>;
  readonly functions: Set<string>;
  readonly parameters: Set<string>;
}

export interface PrivateScopeInfo {
  readonly outer: PrivateScopeInfo | undefined;
  readonly names: Map<string, Set<'field' | 'method' | 'get' | 'set'>>;
}

export interface UndefinedPrivateAccessInfo {
  readonly node: ParseNode;
  readonly name: string;
  readonly scope: PrivateScopeInfo | undefined;
}

export interface ArrowInfo {
  readonly isAsync: boolean;
  hasTrailingComma: boolean;
  readonly yieldExpressions: ParseNode[];
  readonly awaitExpressions: ParseNode[];
  readonly awaitIdentifiers: ParseNode[];
  merge(other: ArrowInfo): void;
}

export interface AssignmentInfo {
  readonly type: 'assign' | 'arrow' | 'for';
  readonly earlyErrors: ErrorObject[];
  clear(): void;
}

export type LabelType = 'switch' | 'loop';

export interface Label {
  type: LabelType | null;
  readonly name?: string;
  readonly nextToken?: TokenData | null;
}

export class Scope {
  private readonly parser: Parser;

  private readonly scopeStack: ScopeInfo[] = [];

  labels: Label[] = [];

  readonly arrowInfoStack: (ArrowInfo | null)[] = [];

  readonly assignmentInfoStack: AssignmentInfo[] = [];

  private arrowParameterCandidateDepth = 0;

  private arrowBodyDepth = 0;

  readonly exports = new Set<string>();

  readonly undefinedExports = new Map<string, ParseNode.ModuleExportName>();

  privateScope: PrivateScopeInfo | undefined;

  private readonly undefinedPrivateAccesses: UndefinedPrivateAccessInfo[] = [];

  private flags: Flag = 0 as Flag;

  constructor(parser: Parser) {
    this.parser = parser;
  }

  hasReturn() {
    return (this.flags & Flag.return) !== 0;
  }

  hasAwait() {
    return (this.flags & Flag.await) !== 0;
  }

  hasYield() {
    return (this.flags & Flag.yield) !== 0;
  }

  hasNewTarget() {
    return (this.flags & Flag.newTarget) !== 0;
  }

  hasSuperCall() {
    return (this.flags & Flag.superCall) !== 0;
  }

  hasSuperProperty() {
    return (this.flags & Flag.superProperty) !== 0;
  }

  hasImportMeta() {
    return (this.flags & Flag.importMeta) !== 0;
  }

  hasIn() {
    return (this.flags & Flag.in) !== 0;
  }

  inParameters() {
    return (this.flags & Flag.parameters) !== 0;
  }

  inClassStaticBlock() {
    return (this.flags & Flag.classStaticBlock) !== 0;
  }

  isDefault() {
    return (this.flags & Flag.default) !== 0;
  }

  isModule() {
    return (this.flags & Flag.module) !== 0;
  }

  inArrowParameterCandidate() {
    return this.arrowParameterCandidateDepth > 0;
  }

  enterArrowParameterCandidate() {
    this.arrowParameterCandidateDepth += 1;
  }

  exitArrowParameterCandidate() {
    this.arrowParameterCandidateDepth -= 1;
  }

  inArrowBody() {
    return this.arrowBodyDepth > 0;
  }

  enterArrowBody() {
    this.arrowBodyDepth += 1;
  }

  exitArrowBody() {
    this.arrowBodyDepth -= 1;
  }

  with<R>(flags: ScopeFlagSetters, f: () => R) {
    const oldFlags = this.flags;

    Object.entries(flags)
      .forEach(([k, v]) => {
        if (k in Flag && typeof Flag[k as keyof typeof Flag] === 'number') {
          if (v === true) {
            this.flags |= Flag[k as keyof typeof Flag];
          } else if (v === false) {
            this.flags &= ~Flag[k as keyof typeof Flag];
          }
        }
      });

    if (flags.lexical || flags.variable) {
      this.scopeStack.push({
        flags,
        lexicals: new Set(),
        variables: new Set(),
        functions: new Set(),
        parameters: new Set(),
      });
    }

    if (flags.private) {
      this.privateScope = {
        outer: this.privateScope,
        names: new Map(),
      };
    }

    const oldLabels = this.labels;
    if (flags.label === 'boundary') {
      this.labels = [];
    } else if (flags.label) {
      this.labels.push({ type: flags.label });
    }

    const oldStrict = this.parser.state.strict;
    if (flags.strict === true) {
      this.parser.state.strict = true;
    } else if (flags.strict === false) {
      this.parser.state.strict = false;
    }

    const r = f();

    if (flags.label === 'boundary') {
      this.labels = oldLabels;
    } else if (flags.label) {
      this.labels.pop();
    }

    if (flags.private) {
      this.privateScope = this.privateScope!.outer;

      if (this.privateScope === undefined) {
        this.undefinedPrivateAccesses.forEach(({ node, name, scope }) => {
          while (scope) {
            if (scope.names.has(name)) {
              return;
            }
            scope = scope.outer;
          }
          this.parser.addEarlyError(Throw.SyntaxError('Private identifier $1 not defined', name), node);
        });
      }
    }

    if (flags.lexical || flags.variable) {
      this.scopeStack.pop();
    }

    this.parser.state.strict = oldStrict;
    this.flags = oldFlags;

    return r;
  }

  pushArrowInfo(isAsync = false) {
    this.arrowInfoStack.push({
      isAsync,
      hasTrailingComma: false,
      yieldExpressions: [],
      awaitExpressions: [],
      awaitIdentifiers: [],
      merge(other) {
        this.yieldExpressions.push(...other.yieldExpressions);
        this.awaitExpressions.push(...other.awaitExpressions);
        this.awaitIdentifiers.push(...other.awaitIdentifiers);
      },
    });
  }

  popArrowInfo() {
    const arrowInfo = this.arrowInfoStack.pop();
    Assert(!!arrowInfo);
    return arrowInfo;
  }

  get arrowInfo() {
    if (this.arrowInfoStack.length > 0) {
      return this.arrowInfoStack[this.arrowInfoStack.length - 1];
    }
    return undefined;
  }

  pushAssignmentInfo(type: 'assign' | 'arrow' | 'for') {
    const parser = this.parser;
    this.assignmentInfoStack.push({
      type,
      earlyErrors: [],
      clear() {
        this.earlyErrors.forEach((e) => {
          parser.earlyErrors.delete(e);
        });
      },
    });
  }

  popAssignmentInfo() {
    const assignmentInfo = this.assignmentInfoStack.pop();
    Assert(!!assignmentInfo);
    return assignmentInfo;
  }

  registerObjectLiteralEarlyError(error: ErrorObject) {
    for (let i = this.assignmentInfoStack.length - 1; i >= 0; i -= 1) {
      const info = this.assignmentInfoStack[i];
      info.earlyErrors.push(error);
      if (info.type !== 'assign') {
        break;
      }
    }
  }

  lexicalScope() {
    for (let i = this.scopeStack.length - 1; i >= 0; i -= 1) {
      const scope = this.scopeStack[i];
      if (scope.flags.lexical) {
        return scope;
      }
    }
    /* node:coverage ignore next */
    throw new RangeError();
  }

  variableScope() {
    for (let i = this.scopeStack.length - 1; i >= 0; i -= 1) {
      const scope = this.scopeStack[i];
      if (scope.flags.variable) {
        return scope;
      }
    }
    /* node:coverage ignore next */
    throw new RangeError();
  }

  declare(node: ParseNode | readonly ParseNode[], type: 'private', extraType?: 'field' | 'method' | 'get' | 'set'): void;

  declare(node: ParseNode | readonly ParseNode[], type: 'lexical' | 'lexical-allow-let' | 'import' | 'function' | 'parameter' | 'variable' | 'export'): void;

  declare(node: ParseNode | readonly ParseNode[], type: 'lexical' | 'lexical-allow-let' | 'import' | 'function' | 'parameter' | 'variable' | 'export' | 'private', extraType?: 'field' | 'method' | 'get' | 'set') {
    const declarations = getDeclarations(node);
    declarations.forEach((d) => {
      switch (type) {
        case 'lexical':
        case 'lexical-allow-let':
        case 'import': {
          if (type === 'lexical' && d.name === 'let') {
            this.parser.addEarlyError(Throw.SyntaxError('Let in lexical binding'), d.node);
          }
          const scope = this.lexicalScope();
          if (scope.lexicals.has(d.name)
              || scope.variables.has(d.name)
              || scope.functions.has(d.name)
              || scope.parameters.has(d.name)) {
            this.parser.addEarlyError(Throw.SyntaxError('Identifier $1 already declared', d.name), d.node);
          }
          scope.lexicals.add(d.name);
          if (scope === this.scopeStack[0] && this.undefinedExports.has(d.name)) {
            this.undefinedExports.delete(d.name);
          }
          break;
        }
        case 'function': {
          const scope = this.lexicalScope();
          if (scope.lexicals.has(d.name)) {
            this.parser.addEarlyError(Throw.SyntaxError('Function $1 already declared', d.name), d.node);
          }
          if (scope.flags.variableFunctions) {
            scope.functions.add(d.name);
          } else {
            if (scope.variables.has(d.name)) {
              this.parser.addEarlyError(Throw.SyntaxError('Function $1 already declared', d.name), d.node);
            }
            scope.lexicals.add(d.name);
          }
          if (scope === this.scopeStack[0] && this.undefinedExports.has(d.name)) {
            this.undefinedExports.delete(d.name);
          }
          break;
        }
        case 'parameter':
          this.variableScope().parameters.add(d.name);
          break;
        case 'variable':
          for (let i = this.scopeStack.length - 1; i >= 0; i -= 1) {
            const scope = this.scopeStack[i];
            scope.variables.add(d.name);
            if (scope.lexicals.has(d.name) || (!scope.flags.variableFunctions && scope.functions.has(d.name))) {
              this.parser.addEarlyError(Throw.SyntaxError('Variable $1 already declared', d.name), d.node);
            }
            if (i === 0 && this.undefinedExports.has(d.name)) {
              this.undefinedExports.delete(d.name);
            }
            if (scope.flags.variable) {
              break;
            }
          }
          break;
        case 'export':
          if (this.exports.has(d.name)) {
            this.parser.addEarlyError(Throw.SyntaxError('Export identifier $1 already declared', d.name), d.node);
          } else {
            this.exports.add(d.name);
          }
          break;
        case 'private': {
          const types = this.privateScope!.names.get(d.name);
          if (types) {
            let duplicate = true;
            switch (extraType) {
              case 'field':
              case 'method':
                break;
              case 'set':
              case 'get':
                duplicate = types.has(extraType) || types.has('field') || types.has('method');
                types.add(extraType);
                break;
              default:
                break;
            }
            if (duplicate) {
              this.parser.addEarlyError(Throw.SyntaxError('Private identifier $1 already declared', d.name), d.node);
            }
          } else if (extraType) {
            this.privateScope!.names.set(d.name, new Set([extraType]));
          }
          break;
        }
        /* node:coverage ignore next 2 */
        default:
          throw new RangeError(type);
      }
    });
  }

  checkUndefinedExports(NamedExports: ParseNode.NamedExports) {
    const scope = this.variableScope();
    NamedExports.ExportsList.forEach((n) => {
      const name = n.localName.type === 'IdentifierName' ? n.localName.name : n.localName.value;
      if (!scope.lexicals.has(name) && !scope.variables.has(name)) {
        this.undefinedExports.set(name, n.localName);
      }
    });
  }

  checkUndefinedPrivate(PrivateIdentifier: ParseNode.PrivateIdentifier) {
    if (this.parser.state.allowAllPrivateNames) {
      return;
    }
    const [{ node, name }] = getDeclarations(PrivateIdentifier);

    if (!this.privateScope) {
      this.parser.addEarlyError(Throw.SyntaxError('Private identifier $1 not defined', name), node);
      return;
    }

    let scope: PrivateScopeInfo | undefined = this.privateScope;
    while (scope) {
      if (scope.names.has(name)) {
        return;
      }
      scope = scope.outer;
    }

    this.undefinedPrivateAccesses.push({
      node,
      name,
      scope: this.privateScope,
    });
  }
}
