import { SyntaxKind } from "typescript/unstable/ast";
import type { Expression, Node, SourceFile } from "typescript/unstable/ast";
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
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isStringLiteral,
  isVariableStatement,
} from "typescript/unstable/ast/is";
import type { StoreAssignment, StoreFieldValue, StoreModel } from "./types";

const STORE_MODULE_PATTERN = /^zustand(?:\/traditional)?$/;
const STORE_CREATORS = new Set(["create", "createWithEqualityFn"]);

const skipParentheses = (node: Node): Node =>
  isParenthesizedExpression(node) ? skipParentheses(node.expression) : node;

const isFunctionNode = (node: Node): boolean => isArrowFunction(node) || isFunctionExpression(node);

const getParameterNames = (node: Node): string[] =>
  isArrowFunction(node) || isFunctionExpression(node)
    ? node.parameters.map((parameter) => (isIdentifier(parameter.name) ? parameter.name.text : ""))
    : [];

const getCreatorNames = (sourceFile: SourceFile): Set<string> => {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue;
    if (!STORE_MODULE_PATTERN.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !isNamedImports(bindings)) continue;
    for (const element of bindings.elements)
      if (STORE_CREATORS.has(element.propertyName?.text ?? element.name.text))
        names.add(element.name.text);
  }
  return names;
};

// Unwraps curried `create<State>()(...)` and middleware like `persist(...)`.
const findCreatorFunction = (initializer: Node, creatorNames: Set<string>): Node | null => {
  if (!isCallExpression(initializer)) return null;
  const callee = initializer.expression;
  const isCreator =
    (isIdentifier(callee) && creatorNames.has(callee.text)) ||
    (isCallExpression(callee) &&
      isIdentifier(callee.expression) &&
      creatorNames.has(callee.expression.text));
  if (!isCreator) return null;
  let argument: Node | undefined = initializer.arguments[0];
  while (argument && isCallExpression(argument)) argument = argument.arguments[0];
  return argument && isFunctionNode(argument) ? argument : null;
};

const getReturnedObject = (fn: Node): Node | null => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return null;
  const body = skipParentheses(fn.body);
  if (isObjectLiteralExpression(body)) return body;
  if (!isBlock(body)) return null;
  const returned = body.statements.find(isReturnStatement)?.expression;
  return returned && isObjectLiteralExpression(skipParentheses(returned))
    ? skipParentheses(returned)
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

const getAssignments = (argument: Node, actionParameters: string[]): StoreAssignment[] | null => {
  const expression = skipParentheses(argument);
  const [stateParameter = null] = getParameterNames(expression);
  const object = isFunctionNode(expression) ? getReturnedObject(expression) : expression;
  if (!object || !isObjectLiteralExpression(object)) return null;
  const assignments: StoreAssignment[] = [];
  for (const property of object.properties) {
    if (isSpreadAssignment(property)) continue;
    if (isShorthandPropertyAssignment(property)) {
      const { name } = property;
      if (!isIdentifier(name)) return null;
      assignments.push({
        field: name.text,
        value: getFieldValue(name, name.text, actionParameters, stateParameter),
      });
      continue;
    }
    if (!isPropertyAssignment(property)) return null;
    const { name } = property;
    if (!isIdentifier(name) && !isStringLiteral(name)) return null;
    assignments.push({
      field: name.text,
      value: getFieldValue(property.initializer, name.text, actionParameters, stateParameter),
    });
  }
  return assignments;
};

const findSetCalls = (node: Node, setName: string): Node[] => {
  const calls: Node[] = [];
  const visit = (current: Node): void => {
    if (isFunctionNode(current)) return;
    if (
      isCallExpression(current) &&
      isIdentifier(current.expression) &&
      current.expression.text === setName
    )
      calls.push(current);
    current.forEachChild(visit);
  };
  node.forEachChild(visit);
  return calls;
};

const getActionAssignments = (action: Node, setName: string): StoreAssignment[] | null => {
  if (!isArrowFunction(action) && !isFunctionExpression(action)) return null;
  const parameters = getParameterNames(action);
  const body = skipParentheses(action.body);
  const calls = findSetCalls(action, setName);
  const onlyStatement = isBlock(body) && body.statements.length === 1 ? body.statements[0] : null;
  const isOnlySetCall =
    calls.length === 1 &&
    (calls[0] === body ||
      (onlyStatement !== null &&
        onlyStatement !== undefined &&
        isExpressionStatement(onlyStatement) &&
        skipParentheses(onlyStatement.expression) === calls[0]));
  const assignments = calls.flatMap((call) => {
    const [argument] = isCallExpression(call) ? call.arguments : [];
    return argument ? [getAssignments(argument, parameters)] : [null];
  });
  if (assignments.length === 0 || assignments.some((assigned) => assigned === null)) return null;
  const fields = assignments.flat().filter((assigned) => assigned !== null);
  return isOnlySetCall
    ? fields
    : fields.map(({ field }) => ({ field, value: { kind: "Unknown" } }));
};

export const collectStoreModels = (sourceFile: SourceFile): Map<string, StoreModel> => {
  const models = new Map<string, StoreModel>();
  const creatorNames = getCreatorNames(sourceFile);
  if (creatorNames.size === 0) return models;
  for (const statement of sourceFile.statements) {
    if (!isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!isIdentifier(declaration.name) || !declaration.initializer) continue;
      const creator = findCreatorFunction(declaration.initializer, creatorNames);
      const [setName] = creator ? getParameterNames(creator) : [];
      const state = creator ? getReturnedObject(creator) : null;
      if (!setName || !state || !isObjectLiteralExpression(state)) continue;
      const model: StoreModel = new Map();
      for (const property of state.properties) {
        if (!isPropertyAssignment(property) || !isIdentifier(property.name)) continue;
        const assignments = getActionAssignments(property.initializer, setName);
        if (assignments) model.set(property.name.text, assignments);
      }
      models.set(`${sourceFile.path}#${declaration.name.text}`, model);
    }
  }
  return models;
};
