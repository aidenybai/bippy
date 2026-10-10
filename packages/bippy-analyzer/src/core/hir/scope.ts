import type {
  ArrowFunction,
  BindingName,
  FunctionDeclaration,
  FunctionExpression,
  GetAccessorDeclaration,
  Identifier,
  MethodDeclaration,
  Node,
  SetAccessorDeclaration,
  SourceFile,
  VariableDeclaration,
} from "typescript/unstable/ast";
import { NodeFlags, SyntaxKind } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import { CompilerError } from "../compiler-error.js";
import { GeneratedSource } from "./hir.js";

export type IdentifierNode = Identifier;

export type FunctionNode =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration;

export type BindingKind = "var" | "let" | "const" | "module" | "hoisted" | "param" | "local";

export interface Binding {
  kind: BindingKind;
  identifier: Identifier;
  declaration: Node;
  scope: Scope;
}

export interface Scope {
  node: Node;
  parent: Scope | null;
  bindings: Map<string, Binding>;
}

export const isFunctionNode = (node: Node): node is FunctionNode =>
  t.isFunctionDeclaration(node) ||
  t.isFunctionExpression(node) ||
  t.isArrowFunction(node) ||
  t.isMethodDeclaration(node) ||
  t.isGetAccessorDeclaration(node) ||
  t.isSetAccessorDeclaration(node);

const isVarScopeNode = (node: Node): boolean =>
  t.isSourceFile(node) ||
  isFunctionNode(node) ||
  t.isConstructorDeclaration(node) ||
  t.isClassStaticBlockDeclaration(node);

const isScopeNode = (node: Node): boolean =>
  isVarScopeNode(node) ||
  t.isClassDeclaration(node) ||
  t.isClassExpression(node) ||
  t.isCatchClause(node) ||
  t.isForStatement(node) ||
  t.isForInStatement(node) ||
  t.isForOfStatement(node) ||
  t.isSwitchStatement(node) ||
  (t.isBlock(node) && !isVarScopeNode(node.parent) && !t.isCatchClause(node.parent));

const isTypeOnlyNode = (node: Node): boolean =>
  t.isTypeNode(node) ||
  t.isInterfaceDeclaration(node) ||
  t.isTypeAliasDeclaration(node) ||
  t.isIndexSignatureDeclaration(node);

const getBindingIdentifiers = (name: BindingName): Array<Identifier> => {
  if (t.isIdentifier(name)) {
    return [name];
  }
  return name.elements.flatMap((element) =>
    t.isBindingElement(element) && element.name ? getBindingIdentifiers(element.name) : [],
  );
};

const getVariableBindingKind = (node: VariableDeclaration): BindingKind => {
  if (!t.isVariableDeclarationList(node.parent)) {
    return "let";
  }
  const blockScopedFlags = node.parent.flags & NodeFlags.BlockScoped;
  if (blockScopedFlags === 0) {
    return "var";
  }
  return blockScopedFlags === NodeFlags.Let ? "let" : "const";
};

export class ScopeManager {
  #scopes: Map<Node, Scope> = new Map();
  #declarations: Map<Identifier, Binding> = new Map();

  constructor(sourceFile: SourceFile) {
    const moduleScope = this.#createScope(sourceFile, null);
    sourceFile.forEachChild((child) => {
      this.#visit(child, moduleScope);
    });
  }

  getScope(node: Node): Scope {
    let current: Node | undefined = node;
    while (current !== undefined) {
      const scope = this.#scopes.get(current);
      if (scope !== undefined) {
        return scope;
      }
      current = current.parent;
    }
    CompilerError.invariant(false, {
      reason: "Expected node to belong to the analyzed source file",
      loc: GeneratedSource,
    });
  }

  getBinding(scope: Scope | null, name: string): Binding | null {
    for (let current = scope; current !== null; current = current.parent) {
      const binding = current.bindings.get(name);
      if (binding !== undefined) {
        return binding;
      }
    }
    return null;
  }

  resolveIdentifier(identifier: Identifier): Binding | null {
    return (
      this.#declarations.get(identifier) ??
      this.getBinding(this.getScope(identifier), identifier.text)
    );
  }

  #visit(node: Node, outerScope: Scope): void {
    if (isTypeOnlyNode(node)) {
      return;
    }
    const scope = isScopeNode(node) ? this.#createScope(node, outerScope) : outerScope;
    this.#declare(node, outerScope, scope);
    node.forEachChild((child) => {
      this.#visit(child, scope);
    });
  }

  #createScope(node: Node, parent: Scope | null): Scope {
    const scope: Scope = { node, parent, bindings: new Map() };
    this.#scopes.set(node, scope);
    return scope;
  }

  #declare(node: Node, outerScope: Scope, innerScope: Scope): void {
    if (t.isImportClause(node) && node.name) {
      this.#addBinding("module", node.name, node, outerScope);
    } else if (t.isNamespaceImport(node) || t.isImportSpecifier(node)) {
      this.#addBinding("module", node.name, node, outerScope);
    } else if (t.isVariableDeclaration(node)) {
      const kind = getVariableBindingKind(node);
      const targetScope = kind === "var" ? this.#getVarScope(outerScope) : outerScope;
      for (const identifier of getBindingIdentifiers(node.name)) {
        this.#addBinding(kind, identifier, node, targetScope);
      }
    } else if (t.isParameterDeclaration(node) && outerScope.node === node.parent) {
      for (const identifier of getBindingIdentifiers(node.name)) {
        if (identifier.text !== "this") {
          this.#addBinding("param", identifier, node, outerScope);
        }
      }
    } else if (t.isFunctionDeclaration(node) && node.name && node.body) {
      this.#addBinding("hoisted", node.name, node, outerScope);
    } else if ((t.isClassDeclaration(node) || t.isEnumDeclaration(node)) && node.name) {
      this.#addBinding("let", node.name, node, outerScope);
    } else if ((t.isFunctionExpression(node) || t.isClassExpression(node)) && node.name) {
      this.#addBinding("local", node.name, node, innerScope);
    }
  }

  #getVarScope(scope: Scope): Scope {
    let current = scope;
    while (!isVarScopeNode(current.node) && current.parent !== null) {
      current = current.parent;
    }
    return current;
  }

  #addBinding(kind: BindingKind, identifier: Identifier, declaration: Node, scope: Scope): void {
    if (scope.bindings.has(identifier.text)) {
      return;
    }
    const binding: Binding = { kind, identifier, declaration, scope };
    scope.bindings.set(identifier.text, binding);
    this.#declarations.set(identifier, binding);
  }
}

export const isReferencedIdentifier = (node: Identifier): boolean => {
  const parent = node.parent;
  if (t.isPropertyAccessExpression(parent)) {
    return parent.expression === node;
  }
  if (t.isPropertyAssignment(parent)) {
    return parent.initializer === node;
  }
  if (t.isBindingElement(parent) || t.isVariableDeclaration(parent)) {
    return parent.initializer === node;
  }
  if (t.isParameterDeclaration(parent)) {
    return parent.initializer === node;
  }
  if (
    t.isPropertyDeclaration(parent) ||
    t.isMethodDeclaration(parent) ||
    t.isGetAccessorDeclaration(parent) ||
    t.isSetAccessorDeclaration(parent) ||
    t.isPropertySignatureDeclaration(parent) ||
    t.isMethodSignatureDeclaration(parent) ||
    t.isEnumMember(parent) ||
    t.isFunctionDeclaration(parent) ||
    t.isFunctionExpression(parent) ||
    t.isClassDeclaration(parent) ||
    t.isClassExpression(parent) ||
    t.isEnumDeclaration(parent) ||
    t.isModuleDeclaration(parent) ||
    t.isTypeParameterDeclaration(parent)
  ) {
    return parent.name !== node;
  }
  if (t.isExportSpecifier(parent)) {
    const exportDeclaration = parent.parent.parent;
    return (
      t.isExportDeclaration(exportDeclaration) &&
      exportDeclaration.moduleSpecifier === undefined &&
      (parent.propertyName ?? parent.name) === node
    );
  }
  if (t.isExpressionWithTypeArguments(parent)) {
    const heritageClause = parent.parent;
    return (
      t.isHeritageClause(heritageClause) &&
      heritageClause.token === SyntaxKind.ExtendsKeyword &&
      (t.isClassDeclaration(heritageClause.parent) || t.isClassExpression(heritageClause.parent))
    );
  }
  return !(
    t.isQualifiedName(parent) ||
    t.isTypeNode(parent) ||
    t.isImportClause(parent) ||
    t.isNamespaceImport(parent) ||
    t.isImportSpecifier(parent) ||
    t.isImportEqualsDeclaration(parent) ||
    t.isNamespaceExport(parent) ||
    t.isLabeledStatement(parent) ||
    t.isBreakStatement(parent) ||
    t.isContinueStatement(parent) ||
    t.isJsxAttribute(parent) ||
    t.isJsxNamespacedName(parent) ||
    t.isJsxClosingElement(parent) ||
    t.isMetaProperty(parent)
  );
};
