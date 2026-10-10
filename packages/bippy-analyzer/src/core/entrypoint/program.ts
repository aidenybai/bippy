/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/Entrypoint/Program.ts at b618bbb.

import { SyntaxKind } from "typescript/unstable/ast";
import type {
  ArrowFunction,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  ParameterDeclaration,
  SourceFile,
} from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import type { ReactFunctionType } from "../hir/environment.js";

export type ComponentFunction = FunctionDeclaration | FunctionExpression | ArrowFunction;

export interface ReactFunction {
  name: string;
  node: ComponentFunction;
  fnType: ReactFunctionType;
}

const COMPONENT_NAME_PATTERN = /^[A-Z]/;
const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;
const PASCAL_CASE_NAMESPACE_PATTERN = /^[A-Z].*/;

const isComponentFunction = (node: Node): node is ComponentFunction =>
  t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunction(node);

const skipParentheses = (node: Node): Node =>
  t.isParenthesizedExpression(node) ? skipParentheses(node.expression) : node;

const isHookName = (name: string): boolean => HOOK_NAME_PATTERN.test(name);

/*
 * We consider hooks to be a hook name identifier or a member expression
 * containing a hook name.
 */
const isHook = (node: Node): boolean => {
  if (t.isIdentifier(node)) {
    return isHookName(node.text);
  }
  if (t.isPropertyAccessExpression(node) && isHook(node.name)) {
    const object = node.expression;
    return t.isIdentifier(object) && PASCAL_CASE_NAMESPACE_PATTERN.test(object.text);
  }
  return false;
};

/*
 * Checks if the node is a React component name. React component names must
 * always start with an uppercase letter.
 */
const isComponentName = (node: Node): boolean =>
  t.isIdentifier(node) && COMPONENT_NAME_PATTERN.test(node.text);

const isReactAPI = (node: Node, functionName: string): boolean =>
  (t.isIdentifier(node) && node.text === functionName) ||
  (t.isPropertyAccessExpression(node) &&
    t.isIdentifier(node.expression) &&
    node.expression.text === "React" &&
    node.name.text === functionName);

const isCallbackOf = (node: Node, functionName: string): boolean => {
  const parent = node.parent;
  return (
    t.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === node) &&
    isReactAPI(parent.expression, functionName)
  );
};

/*
 * Checks if the node is a callback argument of forwardRef. This render function
 * should follow the rules of hooks.
 */
const isForwardRefCallback = (node: Node): boolean => isCallbackOf(node, "forwardRef");

/*
 * Checks if the node is a callback argument of React.memo. This anonymous
 * functional component should follow the rules of hooks.
 */
const isMemoCallback = (node: Node): boolean => isCallbackOf(node, "memo");

const isValidPropsAnnotation = (parameter: ParameterDeclaration): boolean => {
  const annotation = parameter.type;
  if (!annotation) {
    return true;
  }
  if (
    t.isArrayTypeNode(annotation) ||
    t.isConstructorTypeNode(annotation) ||
    t.isFunctionTypeNode(annotation) ||
    t.isLiteralTypeNode(annotation) ||
    t.isTupleTypeNode(annotation)
  ) {
    return false;
  }
  switch (annotation.kind) {
    case SyntaxKind.BigIntKeyword:
    case SyntaxKind.BooleanKeyword:
    case SyntaxKind.NeverKeyword:
    case SyntaxKind.NumberKeyword:
    case SyntaxKind.StringKeyword:
    case SyntaxKind.SymbolKeyword:
      return false;
    default:
      return true;
  }
};

const isValidComponentParams = (parameters: readonly ParameterDeclaration[]): boolean => {
  const [firstParameter, secondParameter] = parameters;
  if (!firstParameter) {
    return true;
  }
  if (parameters.length > 2 || !isValidPropsAnnotation(firstParameter)) {
    return false;
  }
  if (!secondParameter) {
    return !firstParameter.dotDotDotToken;
  }
  if (t.isIdentifier(secondParameter.name)) {
    // check if second param might be a ref
    const { text } = secondParameter.name;
    return text.includes("ref") || text.includes("Ref");
  }
  /**
   * Otherwise, avoid helper functions that take more than one argument.
   * Helpers are _usually_ named with lowercase, but some code may
   * violate this rule
   */
  return false;
};

const forEachOwnDescendant = (node: ComponentFunction, visit: (descendant: Node) => void): void => {
  const walk = (child: Node): void => {
    if (isComponentFunction(child) || t.isMethodDeclaration(child)) {
      return;
    }
    visit(child);
    child.forEachChild(walk);
  };
  node.forEachChild(walk);
};

const callsHooksOrCreatesJsx = (node: ComponentFunction): boolean => {
  let invokesHooks = false;
  let createsJsx = false;
  forEachOwnDescendant(node, (descendant) => {
    if (
      t.isJsxElement(descendant) ||
      t.isJsxSelfClosingElement(descendant) ||
      t.isJsxFragment(descendant)
    ) {
      createsJsx = true;
    }
    if (t.isCallExpression(descendant) && isHook(descendant.expression)) {
      invokesHooks = true;
    }
  });
  return invokesHooks || createsJsx;
};

const isNonNode = (node: Expression | undefined): boolean => {
  if (!node) {
    return true;
  }
  const expression = skipParentheses(node);
  return (
    t.isObjectLiteralExpression(expression) ||
    t.isArrowFunction(expression) ||
    t.isFunctionExpression(expression) ||
    t.isBigIntLiteral(expression) ||
    t.isClassExpression(expression) ||
    t.isNewExpression(expression)
  );
};

const returnsNonNode = (node: ComponentFunction): boolean => {
  let isReturningNonNode = false;
  if (t.isArrowFunction(node) && !t.isBlock(node.body)) {
    isReturningNonNode = isNonNode(node.body);
  }
  forEachOwnDescendant(node, (descendant) => {
    if (t.isReturnStatement(descendant)) {
      isReturningNonNode = isNonNode(descendant.expression);
    }
  });
  return isReturningNonNode;
};

/*
 * Gets the static name of a function AST node. For function declarations it is
 * easy. For anonymous function expressions it is much harder. If you search for
 * `IsAnonymousFunctionDefinition()` in the ECMAScript spec you'll find places
 * where JS gives anonymous function expressions names. We roughly detect the
 * same AST nodes with some exceptions to better fit our use case.
 */
const getFunctionName = (node: ComponentFunction): Node | null => {
  if (t.isFunctionDeclaration(node)) {
    return node.name ?? null;
  }
  const parent = node.parent;
  if (t.isVariableDeclaration(parent) && parent.initializer === node) {
    return parent.name;
  }
  if (
    t.isBinaryExpression(parent) &&
    parent.right === node &&
    parent.operatorToken.kind === SyntaxKind.EqualsToken
  ) {
    return parent.left;
  }
  if (
    t.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    t.isIdentifier(parent.name)
  ) {
    return parent.name;
  }
  if (t.isBindingElement(parent) && parent.initializer === node) {
    const bindingName = parent.name;
    return bindingName && t.isIdentifier(bindingName) ? bindingName : null;
  }
  return null;
};

/*
 * Adapted from the ESLint rule at
 * https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/src/RulesOfHooks.js#L90-L103
 */
export const getComponentOrHookLike = (node: ComponentFunction): ReactFunctionType | null => {
  const functionName = getFunctionName(node);
  // Check if the name is component or hook like:
  if (functionName !== null && isComponentName(functionName)) {
    const isComponent =
      callsHooksOrCreatesJsx(node) &&
      isValidComponentParams(node.parameters) &&
      !returnsNonNode(node);
    return isComponent ? "Component" : null;
  }
  if (functionName !== null && isHook(functionName)) {
    // Hooks have hook invocations or JSX, but can take any # of arguments
    return callsHooksOrCreatesJsx(node) ? "Hook" : null;
  }
  /*
   * Otherwise for function or arrow function expressions, check if they
   * appear as the argument to React.forwardRef() or React.memo():
   */
  if (t.isFunctionExpression(node) || t.isArrowFunction(node)) {
    if (isForwardRefCallback(node) || isMemoCallback(node)) {
      // As an added check we also look for hook invocations or JSX
      return callsHooksOrCreatesJsx(node) ? "Component" : null;
    }
  }
  return null;
};

const getDeclaredName = (node: ComponentFunction): string | null => {
  const functionName = getFunctionName(node);
  if (functionName && t.isIdentifier(functionName)) {
    return functionName.text;
  }
  let ancestor: Node = node.parent;
  while (
    t.isCallExpression(ancestor) ||
    t.isParenthesizedExpression(ancestor) ||
    t.isAsExpression(ancestor)
  ) {
    ancestor = ancestor.parent;
  }
  if (t.isVariableDeclaration(ancestor) && t.isIdentifier(ancestor.name)) {
    return ancestor.name.text;
  }
  if (t.isExportAssignment(ancestor)) {
    return "default";
  }
  return null;
};

/**
 * Finds every top-level component and hook in a file, the way the compiler's `infer`
 * compilation mode does. Functions nested inside other functions are left to their parent.
 */
export const findReactFunctions = (sourceFile: SourceFile): ReactFunction[] => {
  const reactFunctions: ReactFunction[] = [];
  const visit = (node: Node): void => {
    if (isComponentFunction(node)) {
      const fnType = getComponentOrHookLike(node);
      const name = getDeclaredName(node);
      if (fnType !== null && name !== null) {
        reactFunctions.push({ name, node, fnType });
      }
      return;
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return reactFunctions;
};

const hasModifier = (node: Node, kind: SyntaxKind): boolean =>
  "modifiers" in node &&
  Array.isArray(node.modifiers) &&
  node.modifiers.some((modifier: Node) => modifier.kind === kind);

/**
 * Maps each exported local name in a file to the name it is exported as.
 */
export const collectExportNames = (sourceFile: SourceFile): Map<string, string> => {
  const exportNames = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    const isExported = hasModifier(statement, SyntaxKind.ExportKeyword);
    if (t.isFunctionDeclaration(statement) && isExported) {
      const name = statement.name?.text ?? "default";
      exportNames.set(name, hasModifier(statement, SyntaxKind.DefaultKeyword) ? "default" : name);
    }
    if (t.isVariableStatement(statement) && isExported) {
      for (const declaration of statement.declarationList.declarations) {
        if (t.isIdentifier(declaration.name))
          exportNames.set(declaration.name.text, declaration.name.text);
      }
    }
    if (t.isExportAssignment(statement)) {
      const expression = skipParentheses(statement.expression);
      exportNames.set(t.isIdentifier(expression) ? expression.text : "default", "default");
    }
    if (
      t.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      t.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportNames.set(
          element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile),
          element.name.getText(sourceFile),
        );
      }
    }
  }
  return exportNames;
};

/**
 * Maps each component in a file to the name it sets with `Component.displayName = "..."`.
 */
export const collectDisplayNames = (sourceFile: SourceFile): Map<string, string> => {
  const displayNames = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!t.isExpressionStatement(statement)) continue;
    const expression = skipParentheses(statement.expression);
    if (
      !t.isBinaryExpression(expression) ||
      expression.operatorToken.kind !== SyntaxKind.EqualsToken
    )
      continue;
    const { left, right } = expression;
    if (
      t.isPropertyAccessExpression(left) &&
      left.name.text === "displayName" &&
      t.isIdentifier(left.expression) &&
      t.isStringLiteral(right)
    ) {
      displayNames.set(left.expression.text, right.text);
    }
  }
  return displayNames;
};

/**
 * Finds the function a module-level name is bound to, such as a reducer declared next to
 * the component that uses it.
 */
export const findModuleFunction = (
  sourceFile: SourceFile,
  name: string,
): ComponentFunction | null => {
  for (const statement of sourceFile.statements) {
    if (t.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (!t.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !t.isIdentifier(declaration.name) ||
        declaration.name.text !== name ||
        !declaration.initializer
      )
        continue;
      const initializer = skipParentheses(declaration.initializer);
      return isComponentFunction(initializer) ? initializer : null;
    }
  }
  return null;
};
