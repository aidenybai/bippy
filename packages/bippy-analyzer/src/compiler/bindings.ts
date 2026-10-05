import type { BindingPattern, Node } from "oxc-parser";
import type { FunctionLikeNode } from "../parse/source-types.js";
import { forEachChildNode } from "../parse/ast-walk.js";
import { UnsupportedControlFlow, type FlowVariable } from "./ir.js";

export interface LexicalBinding extends FlowVariable {
  kind: "var" | "let" | "const" | "parameter" | "function" | "class" | "catch" | "self";
  owner: Node;
  declaration: Node;
  parameterSource?: LexicalBinding;
}

export interface LexicalScope {
  parent: LexicalScope | null;
  bindings: Map<string, LexicalBinding>;
  owner: Node;
  isVarScope: boolean;
  isParameterScope: boolean;
  simpleParameters: boolean;
}

export interface FunctionBindings {
  root: LexicalScope;
  scopes: WeakMap<Node, LexicalScope>;
  references: WeakMap<Node, LexicalBinding>;
  declarations: WeakMap<Node, LexicalBinding>;
  owned: LexicalBinding[];
  dynamicScope: boolean;
}

export const isFunction = (node: Node): node is FunctionLikeNode =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "TSDeclareFunction" ||
  node.type === "TSEmptyBodyFunctionExpression";

export const getBinding = (scope: LexicalScope, name: string): LexicalBinding | undefined => {
  for (let current: LexicalScope | null = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return undefined;
};

const isTypeKey = (key: string): boolean =>
  [
    "typeAnnotation",
    "typeParameters",
    "typeArguments",
    "returnType",
    "superTypeArguments",
    "implements",
  ].includes(key);

export const bindFunction = (root: FunctionLikeNode): FunctionBindings => {
  const scopes = new WeakMap<Node, LexicalScope>();
  const references = new WeakMap<Node, LexicalBinding>();
  const declarations = new WeakMap<Node, LexicalBinding>();
  const owned: LexicalBinding[] = [];
  const identifiers: Node[] = [];
  let dynamicScope = false;
  let nextBinding = 0;
  let visitedNodes = 0;
  let depth = 0;
  const createScope = (
    parent: LexicalScope | null,
    owner: Node,
    isVarScope = false,
    isParameterScope = false,
    simpleParameters = false,
  ): LexicalScope => ({
    parent,
    owner,
    isVarScope,
    isParameterScope,
    simpleParameters,
    bindings: new Map(),
  });
  const declare = (
    node: Node,
    name: string,
    scope: LexicalScope,
    kind: LexicalBinding["kind"],
  ): LexicalBinding => {
    let binding = scope.bindings.get(name);
    if (
      !binding &&
      kind === "var" &&
      scope.parent?.isParameterScope &&
      scope.parent.simpleParameters
    )
      binding = scope.parent.bindings.get(name);
    if (!binding) {
      binding = {
        id: nextBinding++,
        name,
        kind,
        owner: scope.owner,
        declaration: node,
        storage: "local",
      };
      if (kind === "var" && scope.parent?.isParameterScope)
        binding.parameterSource = scope.parent.bindings.get(name);
      if (scope.owner === root) owned.push(binding);
    } else if (kind === "function") {
      binding.kind = "function";
      binding.declaration = node;
      delete binding.parameterSource;
    }
    scope.bindings.set(name, binding);
    declarations.set(node, binding);
    return binding;
  };
  const declarePattern = (
    pattern: BindingPattern,
    scope: LexicalScope,
    kind: LexicalBinding["kind"],
  ): void => {
    switch (pattern.type) {
      case "Identifier":
        declare(pattern, pattern.name, scope, kind);
        break;
      case "AssignmentPattern":
        declarePattern(pattern.left, scope, kind);
        break;
      case "ArrayPattern":
        for (const element of pattern.elements)
          if (element)
            declarePattern(
              element.type === "RestElement" ? element.argument : element,
              scope,
              kind,
            );
        break;
      case "ObjectPattern":
        for (const property of pattern.properties)
          declarePattern(
            property.type === "RestElement" ? property.argument : property.value,
            scope,
            kind,
          );
        break;
    }
  };
  const setupFunction = (node: FunctionLikeNode, parent: LexicalScope | null): LexicalScope => {
    const parameterScope = createScope(
      parent,
      node,
      false,
      true,
      node.params.every((parameter) => parameter.type === "Identifier"),
    );
    scopes.set(node, parameterScope);
    if (node.type === "FunctionExpression" && node.id)
      declare(node.id, node.id.name, parameterScope, "self");
    for (const parameter of node.params) {
      const pattern = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
      declarePattern(
        pattern.type === "RestElement" ? pattern.argument : pattern,
        parameterScope,
        "parameter",
      );
      visit(parameter, parameterScope);
    }
    if (node.body?.type === "BlockStatement") {
      const bodyScope = createScope(parameterScope, node, true);
      scopes.set(node.body, bodyScope);
      for (const statement of node.body.body) visit(statement, bodyScope);
    } else if (node.body) visit(node.body, parameterScope);
    return parameterScope;
  };
  const visit = (node: Node, enclosing: LexicalScope): void => {
    if (++visitedNodes > 30000 || ++depth > 256)
      throw new UnsupportedControlFlow(root, "Binding analysis limit exceeded");
    try {
      let scope = enclosing;
      if (isFunction(node)) {
        if ((node.type === "FunctionDeclaration" || node.type === "TSDeclareFunction") && node.id)
          declare(node.id, node.id.name, scope, "function");
        setupFunction(node, scope);
        return;
      }
      if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
        if (node.type === "ClassDeclaration" && node.id)
          declare(node.id, node.id.name, scope, "class");
        scope = createScope(scope, node);
        if (node.id) declare(node.id, node.id.name, scope, "self");
      } else if (
        [
          "BlockStatement",
          "ForStatement",
          "ForInStatement",
          "ForOfStatement",
          "SwitchStatement",
          "CatchClause",
        ].includes(node.type)
      ) {
        scope = createScope(scope, scope.owner);
      }
      scopes.set(node, scope);
      if (node.type === "WithStatement") dynamicScope = true;
      if (node.type === "VariableDeclaration") {
        let target = scope;
        if (node.kind === "var") while (!target.isVarScope && target.parent) target = target.parent;
        const kind = node.kind === "var" || node.kind === "const" ? node.kind : "let";
        for (const declaration of node.declarations) declarePattern(declaration.id, target, kind);
      }
      if (node.type === "CatchClause" && node.param) declarePattern(node.param, scope, "catch");
      if (node.type === "Identifier" || node.type === "JSXIdentifier") identifiers.push(node);
      if (node.type === "Identifier" && node.name === "eval") dynamicScope = true;
      forEachChildNode(node, (child, key) => {
        if (isTypeKey(key) || key === "label") return;
        if (key === "property" && node.type === "MemberExpression" && !node.computed) return;
        if (key === "key" && "computed" in node && !node.computed) return;
        visit(child, node.type === "SwitchStatement" && key === "discriminant" ? enclosing : scope);
      });
    } finally {
      depth--;
    }
  };
  const rootScope = setupFunction(root, null);
  for (const node of identifiers) {
    if (declarations.has(node) || (node.type !== "Identifier" && node.type !== "JSXIdentifier"))
      continue;
    const scope = scopes.get(node)!;
    const binding = getBinding(scope, node.name);
    if (binding) {
      references.set(node, binding);
      if (binding.owner === root && scope.owner !== root) binding.storage = "cell";
    }
    if (node.name === "arguments") {
      for (let owner: LexicalScope | null = scope; owner; owner = owner.parent) {
        if (!owner.isParameterScope || owner.owner.type === "ArrowFunctionExpression") continue;
        if (owner.owner === root) {
          for (const parameter of owned)
            if (parameter.kind === "parameter" || parameter.parameterSource)
              parameter.storage = "cell";
        }
        break;
      }
    }
  }
  return { root: rootScope, scopes, references, declarations, owned, dynamicScope };
};
