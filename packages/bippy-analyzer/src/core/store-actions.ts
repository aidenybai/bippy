import { SyntaxKind } from "typescript/unstable/ast";
import type {
  ArrowFunction,
  Expression,
  FunctionExpression,
  Node,
  SourceFile,
} from "typescript/unstable/ast";
import {
  isArrowFunction,
  isBlock,
  isCallExpression,
  isExpressionStatement,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isNumericLiteral,
  isObjectLiteralExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isStringLiteral,
  isVariableStatement,
} from "typescript/unstable/ast/is";
import type { StoreAssignment, StoreFieldValue, StoreActions } from "./types";
import { skipParentheses } from "./utils/typescript";
import { createDeclarationKey } from "./utils/declaration-key";

const STORE_MODULE_PATTERN = /^zustand(?:\/traditional)?$/;
const STORE_CREATORS = new Set(["create", "createWithEqualityFn"]);

const isFunctionNode = (node: Node): node is ArrowFunction | FunctionExpression =>
  isArrowFunction(node) || isFunctionExpression(node);

const getParameterNames = (node: Node): string[] =>
  isFunctionNode(node)
    ? node.parameters.map((parameter) => (isIdentifier(parameter.name) ? parameter.name.text : ""))
    : [];

const getCreatorNames = (sourceFile: SourceFile): Set<string> => {
  const creatorNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue;
    if (!STORE_MODULE_PATTERN.test(statement.moduleSpecifier.text)) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !isNamedImports(namedBindings)) continue;
    for (const specifier of namedBindings.elements)
      if (STORE_CREATORS.has(specifier.propertyName?.text ?? specifier.name.text))
        creatorNames.add(specifier.name.text);
  }
  return creatorNames;
};

const findStateCreator = (
  initializer: Node,
  creatorNames: Set<string>,
): ArrowFunction | FunctionExpression | null => {
  if (!isCallExpression(initializer)) return null;
  const callee = initializer.expression;
  const isCreator =
    (isIdentifier(callee) && creatorNames.has(callee.text)) ||
    (isCallExpression(callee) &&
      isIdentifier(callee.expression) &&
      creatorNames.has(callee.expression.text));
  if (!isCreator) return null;
  let middlewareOrCreator: Node | undefined = initializer.arguments[0];
  while (middlewareOrCreator && isCallExpression(middlewareOrCreator))
    middlewareOrCreator = middlewareOrCreator.arguments[0];
  return middlewareOrCreator && isFunctionNode(middlewareOrCreator) ? middlewareOrCreator : null;
};

const getReturnedObject = (functionNode: ArrowFunction | FunctionExpression): Node | null => {
  const body = skipParentheses(functionNode.body);
  if (isObjectLiteralExpression(body)) return body;
  if (!isBlock(body)) return null;
  const returnedExpression = body.statements.find(isReturnStatement)?.expression;
  return returnedExpression && isObjectLiteralExpression(skipParentheses(returnedExpression))
    ? skipParentheses(returnedExpression)
    : null;
};

const getLiteralValue = (node: Node): StoreFieldValue | null => {
  if (node.kind === SyntaxKind.TrueKeyword) return { kind: "Literal", value: true };
  if (node.kind === SyntaxKind.FalseKeyword) return { kind: "Literal", value: false };
  if (node.kind === SyntaxKind.NullKeyword) return { kind: "Literal", value: null };
  if (isStringLiteral(node)) return { kind: "Literal", value: node.text };
  if (isNumericLiteral(node)) return { kind: "Literal", value: Number(node.text) };
  return null;
};

const getFieldValue = (
  node: Expression,
  field: string,
  actionParameters: string[],
  stateParameter: string | null,
): StoreFieldValue => {
  const expression = skipParentheses(node);
  if (isIdentifier(expression) && actionParameters.includes(expression.text))
    return { kind: "Argument", index: actionParameters.indexOf(expression.text) };
  const literal = getLiteralValue(expression);
  if (literal) return literal;
  if (
    isPrefixUnaryExpression(expression) &&
    expression.operator === SyntaxKind.ExclamationToken &&
    isPropertyAccessExpression(expression.operand) &&
    isIdentifier(expression.operand.expression) &&
    expression.operand.expression.text === stateParameter &&
    expression.operand.name.text === field
  )
    return { kind: "Toggle" };
  return { kind: "Unknown" };
};

const getAssignments = (
  setArgument: Node,
  actionParameters: string[],
): StoreAssignment[] | null => {
  const expression = skipParentheses(setArgument);
  const [stateParameter = null] = getParameterNames(expression);
  const assignedObject = isFunctionNode(expression) ? getReturnedObject(expression) : expression;
  if (!assignedObject || !isObjectLiteralExpression(assignedObject)) return null;
  const assignments: StoreAssignment[] = [];
  for (const property of assignedObject.properties) {
    if (isSpreadAssignment(property)) continue;
    if (!isShorthandPropertyAssignment(property) && !isPropertyAssignment(property)) return null;
    const { name } = property;
    if (!isIdentifier(name) && !isStringLiteral(name)) return null;
    const valueNode = isPropertyAssignment(property) ? property.initializer : name;
    assignments.push({
      field: name.text,
      value: getFieldValue(valueNode, name.text, actionParameters, stateParameter),
    });
  }
  return assignments;
};

const findSetCalls = (action: Node, setName: string): Node[] => {
  const setCalls: Node[] = [];
  const visit = (node: Node): void => {
    if (isFunctionNode(node)) return;
    if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === setName)
      setCalls.push(node);
    node.forEachChild(visit);
  };
  action.forEachChild(visit);
  return setCalls;
};

const getActionAssignments = (action: Node, setName: string): StoreAssignment[] | null => {
  if (!isFunctionNode(action)) return null;
  const actionParameters = getParameterNames(action);
  const body = skipParentheses(action.body);
  const setCalls = findSetCalls(action, setName);
  const [onlyStatement] = isBlock(body) && body.statements.length === 1 ? body.statements : [];
  const isOnlySetCall =
    setCalls.length === 1 &&
    (setCalls[0] === body ||
      (onlyStatement !== undefined &&
        isExpressionStatement(onlyStatement) &&
        skipParentheses(onlyStatement.expression) === setCalls[0]));
  const assignmentsPerCall = setCalls.map((setCall) => {
    const [setArgument] = isCallExpression(setCall) ? setCall.arguments : [];
    return setArgument ? getAssignments(setArgument, actionParameters) : null;
  });
  if (assignmentsPerCall.length === 0 || assignmentsPerCall.includes(null)) return null;
  const assignments = assignmentsPerCall.flat().filter((assignment) => assignment !== null);
  return isOnlySetCall
    ? assignments
    : assignments.map(({ field }) => ({ field, value: { kind: "Unknown" } }));
};

export const collectStoreActions = (sourceFile: SourceFile): Map<string, StoreActions> => {
  const actionsByStore = new Map<string, StoreActions>();
  const creatorNames = getCreatorNames(sourceFile);
  if (creatorNames.size === 0) return actionsByStore;
  for (const statement of sourceFile.statements) {
    if (!isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!isIdentifier(declaration.name) || !declaration.initializer) continue;
      const creator = findStateCreator(declaration.initializer, creatorNames);
      const [setName] = creator ? getParameterNames(creator) : [];
      const initialState = creator ? getReturnedObject(creator) : null;
      if (!setName || !initialState || !isObjectLiteralExpression(initialState)) continue;
      const actions: StoreActions = new Map();
      for (const property of initialState.properties) {
        if (!isPropertyAssignment(property) || !isIdentifier(property.name)) continue;
        const assignments = getActionAssignments(property.initializer, setName);
        if (assignments) actions.set(property.name.text, assignments);
      }
      actionsByStore.set(createDeclarationKey(sourceFile.path, declaration.name.text), actions);
    }
  }
  return actionsByStore;
};
