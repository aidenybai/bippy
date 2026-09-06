import type {
  ArrowFunctionExpression,
  BindingPattern,
  CallExpression,
  Class,
  Expression,
  Function as FunctionNode,
  IdentifierReference,
  JSXElement,
  JSXElementName,
  JSXFragment,
  MemberExpression,
  Node,
  ObjectExpression,
  ParamPattern,
  Span,
  Statement,
  StaticMemberExpression,
  StringLiteral,
} from "@oxc-project/types";

export type FunctionLike = FunctionNode | ArrowFunctionExpression;

export interface SpannedNode extends Span {
  type: string;
}

export const isNode = (value: unknown): value is SpannedNode =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "type") === "string" &&
  typeof Reflect.get(value, "start") === "number";

export const isFunctionLike = (node: Node | null | undefined): node is FunctionLike =>
  node?.type === "FunctionDeclaration" ||
  node?.type === "FunctionExpression" ||
  node?.type === "ArrowFunctionExpression";

export const isClassLike = (node: Node | null | undefined): node is Class =>
  node?.type === "ClassDeclaration" || node?.type === "ClassExpression";

export const isIdentifierReference = (node: Node | null | undefined): node is IdentifierReference =>
  node?.type === "Identifier";

export const isStringLiteral = (node: Node | null | undefined): node is StringLiteral =>
  node?.type === "Literal" && typeof Reflect.get(node, "value") === "string";

export const isStaticMemberExpression = (
  node: Node | null | undefined,
): node is StaticMemberExpression => node?.type === "MemberExpression" && !node.computed;

export const isMemberExpression = (node: Node | null | undefined): node is MemberExpression =>
  node?.type === "MemberExpression";

export const isJsxElement = (node: Node | null | undefined): node is JSXElement =>
  node?.type === "JSXElement";

export const isJsxFragment = (node: Node | null | undefined): node is JSXFragment =>
  node?.type === "JSXFragment";

export const isObjectExpression = (node: Node | null | undefined): node is ObjectExpression =>
  node?.type === "ObjectExpression";

export const isCallExpression = (node: Node | null | undefined): node is CallExpression =>
  node?.type === "CallExpression";

/**
 * Strips wrappers that have no runtime meaning: parentheses, TypeScript
 * assertions, non-null assertions and instantiation expressions.
 */
export const unwrapExpression = (expression: Expression): Expression => {
  let current = expression;
  while (true) {
    switch (current.type) {
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "TSInstantiationExpression":
        current = current.expression;
        continue;
      default:
        return current;
    }
  }
};

/**
 * Returns the identifier chain of a static member access such as
 * `React.Fragment` → `["React", "Fragment"]`. Returns `null` when any link
 * is computed or not an identifier.
 */
export const getMemberChain = (expression: Expression): string[] | null => {
  const chain: string[] = [];
  let current: Expression = unwrapExpression(expression);
  while (true) {
    if (current.type === "Identifier") {
      chain.unshift(current.name);
      return chain;
    }
    if (current.type === "ThisExpression") {
      chain.unshift("this");
      return chain;
    }
    if (current.type === "ChainExpression") {
      const element = current.expression;
      if (element.type === "CallExpression" || element.type === "TSNonNullExpression") return null;
      current = element;
      continue;
    }
    if (current.type === "MemberExpression" && !current.computed) {
      if (current.property.type !== "Identifier") return null;
      chain.unshift(current.property.name);
      current = unwrapExpression(current.object);
      continue;
    }
    return null;
  }
};

export const getJsxNameChain = (name: JSXElementName): string[] | null => {
  switch (name.type) {
    case "JSXIdentifier":
      return [name.name];
    case "JSXNamespacedName":
      return [`${name.namespace.name}:${name.name.name}`];
    case "JSXMemberExpression": {
      const objectChain = getJsxNameChain(name.object);
      return objectChain ? [...objectChain, name.property.name] : null;
    }
  }
};

export const getBindingPattern = (parameter: ParamPattern): BindingPattern | null => {
  switch (parameter.type) {
    case "TSParameterProperty":
      return parameter.parameter;
    case "RestElement":
      return null;
    default:
      return parameter;
  }
};

/**
 * Returns the statements of a block-bodied function, or `null` for an
 * arrow function whose body is a single expression.
 */
export const getFunctionStatements = (fn: FunctionLike): Statement[] | null => {
  if (fn.body === null) return [];
  if (fn.body.type === "BlockStatement") return fn.body.body;
  return null;
};

export const getExpressionBody = (fn: FunctionLike): Expression | null => {
  if (fn.type !== "ArrowFunctionExpression") return null;
  return fn.body.type === "BlockStatement" ? null : fn.body;
};

/**
 * Finds an instance method or a function-valued instance property by name.
 */
export const getClassMember = (classNode: Class, memberName: string): FunctionLike | null => {
  for (const element of classNode.body.body) {
    if (element.type !== "MethodDefinition" && element.type !== "PropertyDefinition") continue;
    if (element.computed || element.static) continue;
    if (element.key.type !== "Identifier" || element.key.name !== memberName) continue;
    if (element.type === "MethodDefinition") return element.value;
    if (element.value && isFunctionLike(element.value)) return element.value;
  }
  return null;
};

export const forEachChildNode = (node: object, visit: (child: SpannedNode) => void): void => {
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = Reflect.get(node, key);
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) visit(item);
    } else if (isNode(value)) {
      visit(value);
    }
  }
};

/**
 * Depth-first traversal. Return `false` from the visitor to skip a subtree.
 */
export const walk = (root: object, visit: (node: SpannedNode) => boolean | void): void => {
  const stack: object[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (isNode(current) && visit(current) === false) continue;
    const children: SpannedNode[] = [];
    forEachChildNode(current, (child) => {
      children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
};
