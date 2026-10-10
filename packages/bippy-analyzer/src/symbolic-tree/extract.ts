import { SyntaxKind } from "typescript/unstable/ast";
import type { Node, SourceFile, Statement } from "typescript/unstable/ast";
import * as is from "typescript/unstable/ast/is";
import type { Checker } from "typescript/unstable/sync";
import { getDomainAtNode, getDomainOfType } from "./domain.ts";
import { getSamples } from "./samples.ts";
import { getAtomKey, negate } from "./expression.ts";
import type {
  Attribute,
  Bailout,
  ComponentModel,
  Domain,
  Expression,
  ObjectField,
  RenderNode,
  Slot,
  SourceSpan,
  Transition,
  Update,
} from "./model.ts";

interface ImportBinding {
  module: string;
  importedName: string;
}

interface ReducerBinding {
  stateSlot: string;
  reducer: Node | undefined;
}

interface ComponentContext {
  checker: Checker;
  sourceFile: SourceFile;
  imports: Map<string, ImportBinding>;
  moduleDeclarations: Map<string, Node>;
  slots: Map<string, Slot>;
  atoms: Map<string, Domain>;
  aliases: Map<string, string>;
  propsObjectName: string | undefined;
  setters: Map<string, string>;
  dispatchers: Map<string, ReducerBinding>;
  locals: Map<string, Node>;
  functions: Map<string, Node>;
  transitions: Transition[];
  bailouts: Bailout[];
  renders: Set<string>;
  inlineStack: Set<string>;
  eventNames: Set<string>;
}

interface HookCall {
  name: string;
  isReact: boolean;
}

interface VisitState {
  guards: Expression[];
  isAsync: boolean;
}

const REACT_MODULES = new Set(["react", "react-dom"]);
const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;
const COMPONENT_NAME_PATTERN = /^[A-Z]/;
const SUPPORTED_BINARY_OPERATORS = new Set([
  "===",
  "!==",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "+",
  "-",
  "*",
  "/",
  "%",
]);
const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
const STATE_HOOKS = new Set(["useState", "useOptimistic"]);
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const COMPONENT_WRAPPERS = new Set(["memo", "forwardRef"]);

const getLine = (sourceFile: SourceFile, node: Node): number =>
  getPosition(sourceFile, node.getStart(sourceFile)).line;

const lineStartsByFile = new Map<string, number[]>();

const getLineStarts = (sourceFile: SourceFile): number[] => {
  const cached = lineStartsByFile.get(sourceFile.fileName);
  if (cached) return cached;
  const lineStarts = [0];
  for (let index = 0; index < sourceFile.text.length; index++)
    if (sourceFile.text.charCodeAt(index) === 10) lineStarts.push(index + 1);
  lineStartsByFile.set(sourceFile.fileName, lineStarts);
  return lineStarts;
};

const getPosition = (sourceFile: SourceFile, offset: number): { line: number; column: number } => {
  const lineStarts = getLineStarts(sourceFile);
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 };
};

const getSpan = (sourceFile: SourceFile, node: Node): SourceSpan => {
  const start = getPosition(sourceFile, node.getStart(sourceFile));
  const end = getPosition(sourceFile, node.getEnd());
  return {
    start: node.getStart(sourceFile),
    end: node.getEnd(),
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
};

const getNodeText = (sourceFile: SourceFile, node: Node): string =>
  node.getText(sourceFile).replace(/\s+/g, " ").trim();

const unwrapExpression = (node: Node): Node => {
  if (
    is.isParenthesizedExpression(node) ||
    is.isAsExpression(node) ||
    is.isSatisfiesExpression(node) ||
    is.isNonNullExpression(node)
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
};

const isFunctionNode = (node: Node): boolean =>
  is.isArrowFunction(node) || is.isFunctionExpression(node) || is.isFunctionDeclaration(node);

const getFunctionBody = (node: Node): Node | undefined => {
  if (is.isArrowFunction(node) || is.isFunctionExpression(node) || is.isFunctionDeclaration(node))
    return node.body;
  return undefined;
};

const getFunctionParameters = (node: Node): readonly Node[] => {
  if (is.isArrowFunction(node) || is.isFunctionExpression(node) || is.isFunctionDeclaration(node))
    return node.parameters;
  return [];
};

const getStatements = (node: Node | undefined): Statement[] => {
  if (!node) return [];
  if (is.isBlock(node)) return [...node.statements];
  if (is.isReturnStatement(node) || is.isIfStatement(node) || is.isExpressionStatement(node))
    return [node];
  return [];
};

const someDescendant = (node: Node, predicate: (child: Node) => boolean): boolean => {
  let isFound = false;
  const visit = (child: Node): void => {
    if (isFound) return;
    if (predicate(child)) {
      isFound = true;
      return;
    }
    if (isFunctionNode(child)) return;
    child.forEachChild(visit);
  };
  node.forEachChild(visit);
  return isFound;
};

const containsReturn = (node: Node): boolean =>
  is.isReturnStatement(node) || someDescendant(node, (child) => is.isReturnStatement(child));

const containsAwait = (node: Node): boolean =>
  is.isAwaitExpression(node) || someDescendant(node, (child) => is.isAwaitExpression(child));

const isJsxNode = (node: Node): boolean =>
  is.isJsxElement(node) || is.isJsxSelfClosingElement(node) || is.isJsxFragment(node);

const collectImports = (sourceFile: SourceFile): Map<string, ImportBinding> => {
  const imports = new Map<string, ImportBinding>();
  for (const statement of sourceFile.statements) {
    if (
      !is.isImportDeclaration(statement) ||
      !statement.importClause ||
      !is.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause.name) imports.set(clause.name.text, { module, importedName: "default" });
    const bindings = clause.namedBindings;
    if (bindings && is.isNamespaceImport(bindings))
      imports.set(bindings.name.text, { module, importedName: "*" });
    if (bindings && is.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, {
          module,
          importedName: element.propertyName?.getText(sourceFile) ?? element.name.text,
        });
      }
    }
  }
  return imports;
};

const collectModuleDeclarations = (sourceFile: SourceFile): Map<string, Node> => {
  const declarations = new Map<string, Node>();
  for (const statement of sourceFile.statements) {
    if (is.isFunctionDeclaration(statement) && statement.name)
      declarations.set(statement.name.text, statement);
    if (is.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (is.isIdentifier(declaration.name) && declaration.initializer)
          declarations.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return declarations;
};

const getHookCall = (node: Node, context: ComponentContext): HookCall | undefined => {
  const call = unwrapExpression(node);
  if (!is.isCallExpression(call)) return undefined;
  const callee = call.expression;
  if (is.isIdentifier(callee)) {
    const binding = context.imports.get(callee.text);
    if (binding && REACT_MODULES.has(binding.module))
      return { name: binding.importedName, isReact: true };
    if (HOOK_NAME_PATTERN.test(callee.text)) return { name: callee.text, isReact: false };
    return undefined;
  }
  if (is.isPropertyAccessExpression(callee) && is.isIdentifier(callee.expression)) {
    const binding = context.imports.get(callee.expression.text);
    const name = callee.name.text;
    if (binding && REACT_MODULES.has(binding.module)) return { name, isReact: true };
    if (HOOK_NAME_PATTERN.test(name)) return { name, isReact: false };
  }
  return undefined;
};

const addBailout = (context: ComponentContext, reason: string, node: Node): void => {
  context.bailouts.push({
    reason,
    text: getNodeText(context.sourceFile, node).slice(0, 80),
    line: getLine(context.sourceFile, node),
    span: getSpan(context.sourceFile, node),
  });
};

const opaque = (context: ComponentContext, node: Node, reason: string): Expression => ({
  kind: "opaque",
  reason,
  text: getNodeText(context.sourceFile, node).slice(0, 60),
});

const recordAtom = (context: ComponentContext, key: string, node: Node): void => {
  if (!context.atoms.has(key)) context.atoms.set(key, getDomainAtNode(context.checker, node));
};

const getLiteralText = (node: Node): string | undefined => {
  if (is.isStringLiteral(node) || is.isNoSubstitutionTemplateLiteral(node))
    return JSON.stringify(node.text);
  if (is.isNumericLiteral(node)) return node.text;
  if (node.kind === SyntaxKind.TrueKeyword) return "true";
  if (node.kind === SyntaxKind.FalseKeyword) return "false";
  if (node.kind === SyntaxKind.NullKeyword) return "null";
  if (is.isIdentifier(node) && node.text === "undefined") return "undefined";
  if (
    is.isPrefixUnaryExpression(node) &&
    node.operator === SyntaxKind.MinusToken &&
    is.isNumericLiteral(node.operand)
  )
    return `-${node.operand.text}`;
  return undefined;
};

const lowerIdentifier = (name: string, node: Node, context: ComponentContext): Expression => {
  const aliasedSlot = context.aliases.get(name);
  if (aliasedSlot) return { kind: "slot", slot: aliasedSlot, path: [] };
  if (context.slots.has(name)) {
    recordAtom(context, name, node);
    return { kind: "slot", slot: name, path: [] };
  }
  if (context.setters.has(name)) return opaque(context, node, "setter");
  if (context.eventNames.has(name)) return opaque(context, node, "event");
  const local = context.locals.get(name);
  if (local && !context.inlineStack.has(name)) {
    context.inlineStack.add(name);
    const lowered = lowerExpression(local, context);
    context.inlineStack.delete(name);
    return lowered;
  }
  if (context.functions.has(name)) return opaque(context, node, "function");
  return opaque(context, node, "free-variable");
};

const lowerObjectLiteral = (node: Node, context: ComponentContext): Expression => {
  if (!is.isObjectLiteralExpression(node)) return opaque(context, node, "object");
  const fields: ObjectField[] = [];
  for (const property of node.properties) {
    if (is.isPropertyAssignment(property))
      fields.push({
        name: property.name.getText(context.sourceFile),
        value: lowerExpression(property.initializer, context),
      });
    else if (is.isShorthandPropertyAssignment(property)) {
      const name = property.name.getText(context.sourceFile);
      fields.push({ name, value: lowerIdentifier(name, property.name, context) });
    } else if (is.isSpreadAssignment(property))
      fields.push({ name: "...", value: lowerExpression(property.expression, context) });
    else return opaque(context, node, "object-member");
  }
  return { kind: "object", fields };
};

export const lowerExpression = (rawNode: Node, context: ComponentContext): Expression => {
  const node = unwrapExpression(rawNode);
  const literal = getLiteralText(node);
  if (literal !== undefined) return { kind: "literal", text: literal };
  if (is.isIdentifier(node)) return lowerIdentifier(node.text, node, context);
  if (is.isPropertyAccessExpression(node)) {
    if (is.isIdentifier(node.expression) && node.expression.text === context.propsObjectName) {
      return lowerIdentifier(node.name.text, node, context);
    }
    const base = lowerExpression(node.expression, context);
    if (base.kind !== "slot")
      return opaque(context, node, base.kind === "opaque" ? base.reason : "member");
    const path = [...base.path, node.name.text];
    recordAtom(context, getAtomKey(base.slot, path), node);
    return { kind: "slot", slot: base.slot, path };
  }
  if (is.isPrefixUnaryExpression(node)) {
    const operator =
      node.operator === SyntaxKind.ExclamationToken
        ? "!"
        : node.operator === SyntaxKind.MinusToken
          ? "-"
          : undefined;
    if (!operator) return opaque(context, node, "unary");
    return { kind: "unary", operator, operand: lowerExpression(node.operand, context) };
  }
  if (is.isBinaryExpression(node)) {
    const operator = node.operatorToken.getText(context.sourceFile);
    if (!SUPPORTED_BINARY_OPERATORS.has(operator)) return opaque(context, node, "operator");
    return {
      kind: "binary",
      operator,
      left: lowerExpression(node.left, context),
      right: lowerExpression(node.right, context),
    };
  }
  if (is.isConditionalExpression(node)) {
    return {
      kind: "conditional",
      condition: lowerExpression(node.condition, context),
      whenTrue: lowerExpression(node.whenTrue, context),
      whenFalse: lowerExpression(node.whenFalse, context),
    };
  }
  if (is.isObjectLiteralExpression(node)) return lowerObjectLiteral(node, context);
  if (is.isArrayLiteralExpression(node)) {
    const spreads = node.elements.flatMap((element) =>
      is.isSpreadElement(element) ? [lowerExpression(element.expression, context)] : [],
    );
    return { kind: "array", spreads, itemCount: node.elements.length - spreads.length };
  }
  if (is.isAwaitExpression(node)) return opaque(context, node, "async");
  if (is.isCallExpression(node)) {
    const callee = unwrapExpression(node.expression);
    if (is.isPropertyAccessExpression(callee) && callee.name.text === "map") {
      const source = lowerExpression(callee.expression, context);
      if (source.kind === "slot") return { kind: "array", spreads: [source], itemCount: 0 };
    }
    return opaque(context, node, "call");
  }
  if (isFunctionNode(node)) return opaque(context, node, "function");
  if (isJsxNode(node)) return opaque(context, node, "jsx");
  return opaque(context, node, SyntaxKind[node.kind] ?? "expression");
};

const lowerWithAliases = (
  node: Node,
  aliases: [string, string][],
  context: ComponentContext,
): Expression => {
  for (const [name, slot] of aliases) context.aliases.set(name, slot);
  const lowered = lowerExpression(node, context);
  for (const [name] of aliases) context.aliases.delete(name);
  return lowered;
};

const getReturnedExpression = (functionNode: Node): Node | undefined => {
  const body = getFunctionBody(functionNode);
  if (!body) return undefined;
  if (!is.isBlock(body)) return body;
  const returnStatement = body.statements.find((statement) => is.isReturnStatement(statement));
  return returnStatement && is.isReturnStatement(returnStatement)
    ? returnStatement.expression
    : undefined;
};

const getParameterName = (functionNode: Node, index: number): string | undefined => {
  const parameter = getFunctionParameters(functionNode)[index];
  return parameter && is.isParameterDeclaration(parameter) && is.isIdentifier(parameter.name)
    ? parameter.name.text
    : undefined;
};

const lowerSetterArgument = (
  argument: Node | undefined,
  slot: string,
  context: ComponentContext,
): Expression => {
  if (!argument) return { kind: "literal", text: "undefined" };
  const node = unwrapExpression(argument);
  if (is.isArrowFunction(node) || is.isFunctionExpression(node)) {
    const parameterName = getParameterName(node, 0);
    const returned = getReturnedExpression(node);
    if (!returned) return opaque(context, node, "updater");
    return lowerWithAliases(returned, parameterName ? [[parameterName, slot]] : [], context);
  }
  return lowerExpression(node, context);
};

const getActionType = (action: Node | undefined): string | undefined => {
  if (!action) return undefined;
  const node = unwrapExpression(action);
  if (!is.isObjectLiteralExpression(node)) return getLiteralText(node);
  for (const property of node.properties) {
    if (is.isPropertyAssignment(property) && property.name.getText() === "type")
      return getLiteralText(unwrapExpression(property.initializer));
  }
  return undefined;
};

const findReducerCase = (reducer: Node, actionType: string): Node | undefined => {
  let found: Node | undefined;
  const visit = (node: Node): void => {
    if (found) return;
    if (is.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        if (
          is.isCaseClause(clause) &&
          getLiteralText(unwrapExpression(clause.expression)) === actionType
        ) {
          const returnStatement = clause.statements.find((statement) =>
            is.isReturnStatement(statement),
          );
          if (returnStatement && is.isReturnStatement(returnStatement))
            found = returnStatement.expression;
          return;
        }
      }
    }
    node.forEachChild(visit);
  };
  const body = getFunctionBody(reducer);
  if (body) visit(body);
  return found;
};

const lowerDispatch = (
  binding: ReducerBinding,
  action: Node | undefined,
  context: ComponentContext,
  call: Node,
): Expression => {
  const actionType = getActionType(action);
  if (!binding.reducer || !actionType) return opaque(context, call, "dispatch");
  const caseExpression = findReducerCase(binding.reducer, actionType);
  if (!caseExpression) return opaque(context, call, "reducer-case");
  const stateParameter = getParameterName(binding.reducer, 0);
  return lowerWithAliases(
    caseExpression,
    stateParameter ? [[stateParameter, binding.stateSlot]] : [],
    context,
  );
};

const collectUpdates = (
  root: Node,
  context: ComponentContext,
  initialState: VisitState,
): { updates: Update[]; delegates: string[] } => {
  const updates: Update[] = [];
  const delegates: string[] = [];
  const visitedFunctions = new Set<string>();

  const pushUpdate = (slot: string, value: Expression, state: VisitState): void => {
    updates.push({
      slot,
      value:
        state.isAsync && value.kind !== "literal"
          ? { kind: "opaque", reason: "async", text: value.kind === "opaque" ? value.text : "" }
          : value,
      guards: state.guards,
      isAsync: state.isAsync,
    });
  };

  const visitCallArgument = (argument: Node, state: VisitState): void => {
    const node = unwrapExpression(argument);
    if (is.isIdentifier(node)) {
      const slot = context.setters.get(node.text);
      if (slot)
        pushUpdate(
          slot,
          { kind: "opaque", reason: "callback-argument", text: node.text },
          { ...state, isAsync: true },
        );
      return;
    }
    visit(node, isFunctionNode(node) ? { ...state, isAsync: true } : state);
  };

  const visitStatements = (statements: readonly Node[], state: VisitState): void => {
    let current = state;
    for (const statement of statements) {
      if (is.isIfStatement(statement)) {
        const condition = lowerExpression(statement.expression, context);
        visit(statement.thenStatement, { ...current, guards: [...current.guards, condition] });
        if (statement.elseStatement)
          visit(statement.elseStatement, {
            ...current,
            guards: [...current.guards, negate(condition)],
          });
        if (containsReturn(statement.thenStatement))
          current = { ...current, guards: [...current.guards, negate(condition)] };
        continue;
      }
      visit(statement, current);
      if (containsAwait(statement)) current = { ...current, isAsync: true };
    }
  };

  const visit = (rawNode: Node, state: VisitState): void => {
    const node = unwrapExpression(rawNode);
    if (is.isBlock(node)) return visitStatements(node.statements, state);
    if (is.isArrowFunction(node) || is.isFunctionExpression(node)) {
      const body = node.body;
      if (is.isBlock(body)) visitStatements(body.statements, state);
      else visit(body, state);
      return;
    }
    if (is.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (is.isIdentifier(callee)) {
        const slot = context.setters.get(callee.text);
        if (slot)
          return pushUpdate(slot, lowerSetterArgument(node.arguments[0], slot, context), state);
        const reducer = context.dispatchers.get(callee.text);
        if (reducer)
          return pushUpdate(
            reducer.stateSlot,
            lowerDispatch(reducer, node.arguments[0], context, node),
            state,
          );
        const localFunction = context.functions.get(callee.text);
        if (localFunction && !visitedFunctions.has(callee.text)) {
          visitedFunctions.add(callee.text);
          visit(localFunction, state);
          return;
        }
        const propSlot = context.slots.get(callee.text);
        if (propSlot?.source === "prop") delegates.push(callee.text);
      }
      if (
        is.isPropertyAccessExpression(callee) &&
        is.isIdentifier(callee.expression) &&
        callee.expression.text === context.propsObjectName
      ) {
        delegates.push(callee.name.text);
      }
      const isPromiseCall =
        is.isPropertyAccessExpression(callee) && PROMISE_METHODS.has(callee.name.text);
      visit(callee, state);
      for (const argument of node.arguments)
        visitCallArgument(argument, isPromiseCall ? { ...state, isAsync: true } : state);
      return;
    }
    node.forEachChild((child) => visit(child, state));
  };

  visit(root, initialState);
  return { updates, delegates };
};

const addTransition = (
  context: ComponentContext,
  trigger: string,
  root: Node,
  spanNode: Node,
): string | undefined => {
  const eventNames = getFunctionParameters(root).flatMap((parameter) =>
    is.isParameterDeclaration(parameter) && is.isIdentifier(parameter.name)
      ? [parameter.name.text]
      : [],
  );
  for (const eventName of eventNames) context.eventNames.add(eventName);
  const { updates, delegates } = collectUpdates(root, context, { guards: [], isAsync: false });
  for (const eventName of eventNames) context.eventNames.delete(eventName);
  if (updates.length === 0 && delegates.length === 0) return undefined;
  const id = `t${context.transitions.length + 1}`;
  context.transitions.push({
    id,
    trigger,
    updates,
    delegates,
    span: getSpan(context.sourceFile, spanNode),
  });
  return id;
};

const resolveHandler = (node: Node, context: ComponentContext): Node | undefined => {
  const handler = unwrapExpression(node);
  if (isFunctionNode(handler)) return handler;
  if (is.isIdentifier(handler)) {
    if (context.functions.has(handler.text)) return context.functions.get(handler.text);
    if (context.setters.has(handler.text) || context.slots.get(handler.text)?.source === "prop")
      return node;
  }
  if (
    is.isPropertyAccessExpression(handler) &&
    is.isIdentifier(handler.expression) &&
    handler.expression.text === context.propsObjectName
  )
    return node;
  if (is.isCallExpression(handler)) return handler;
  return undefined;
};

const addHandlerTransition = (
  context: ComponentContext,
  trigger: string,
  node: Node,
): string | undefined => {
  const handler = unwrapExpression(node);
  if (is.isIdentifier(handler) && context.setters.has(handler.text)) {
    const slot = context.setters.get(handler.text) ?? handler.text;
    const id = `t${context.transitions.length + 1}`;
    context.transitions.push({
      id,
      trigger,
      updates: [
        {
          slot,
          value: { kind: "opaque", reason: "event", text: "event argument" },
          guards: [],
          isAsync: false,
        },
      ],
      delegates: [],
      span: getSpan(context.sourceFile, node),
    });
    return id;
  }
  if (
    (is.isIdentifier(handler) && context.slots.get(handler.text)?.source === "prop") ||
    is.isPropertyAccessExpression(handler)
  ) {
    const id = `t${context.transitions.length + 1}`;
    context.transitions.push({
      id,
      trigger,
      updates: [],
      delegates: [handler.getText(context.sourceFile)],
      span: getSpan(context.sourceFile, node),
    });
    return id;
  }
  const resolved = resolveHandler(node, context);
  return resolved ? addTransition(context, trigger, resolved, node) : undefined;
};

const lowerAttributes = (tag: string, attributes: Node, context: ComponentContext): Attribute[] => {
  const lowered: Attribute[] = [];
  if (!is.isJsxAttributes(attributes)) return lowered;
  for (const property of attributes.properties) {
    if (is.isJsxSpreadAttribute(property)) {
      lowered.push({ name: "...", value: getNodeText(context.sourceFile, property.expression) });
      continue;
    }
    if (!is.isJsxAttribute(property)) continue;
    const name = property.name.getText(context.sourceFile);
    const initializer = property.initializer;
    if (!initializer) {
      lowered.push({ name, value: "true", literal: "true" });
      continue;
    }
    if (is.isStringLiteral(initializer)) {
      lowered.push({
        name,
        value: JSON.stringify(initializer.text),
        literal: JSON.stringify(initializer.text),
      });
      continue;
    }
    const expression = is.isJsxExpression(initializer) ? initializer.expression : undefined;
    if (!expression) continue;
    const attribute: Attribute = { name, value: getNodeText(context.sourceFile, expression) };
    const literal = getLiteralText(unwrapExpression(expression));
    if (literal !== undefined) attribute.literal = literal;
    if (/^on[A-Z]/.test(name)) {
      const transitionId = addHandlerTransition(context, `<${tag}>.${name}`, expression);
      if (transitionId) attribute.transitionId = transitionId;
    }
    lowered.push(attribute);
  }
  return lowered;
};

interface ResolvedTag {
  tag: string;
  isComponent: boolean;
}

const isComponentTag = (tag: string): boolean =>
  COMPONENT_NAME_PATTERN.test(tag) || tag.includes(".");

const resolveTagExpression = (
  rawNode: Node,
  context: ComponentContext,
): ResolvedTag | undefined => {
  const node = unwrapExpression(rawNode);
  if (is.isStringLiteral(node) || is.isNoSubstitutionTemplateLiteral(node))
    return { tag: node.text, isComponent: false };
  if (is.isIdentifier(node) || is.isPropertyAccessExpression(node)) {
    const tag = node.getText(context.sourceFile);
    return isComponentTag(tag) ? { tag, isComponent: true } : undefined;
  }
  return undefined;
};

const lowerJsx = (node: Node, context: ComponentContext): RenderNode => {
  if (is.isJsxFragment(node)) {
    return {
      kind: "element",
      tag: "",
      isComponent: false,
      attributes: [],
      children: lowerJsxChildren(node.children, context),
    };
  }
  const opening = is.isJsxElement(node)
    ? node.openingElement
    : is.isJsxSelfClosingElement(node)
      ? node
      : undefined;
  if (!opening)
    return { kind: "unknown", reason: "jsx", text: getNodeText(context.sourceFile, node) };
  const tag = opening.tagName.getText(context.sourceFile);
  const attributes = lowerAttributes(tag, opening.attributes, context);
  const children = is.isJsxElement(node) ? lowerJsxChildren(node.children, context) : [];
  const createElementNode = (resolvedTag: ResolvedTag): RenderNode => {
    if (resolvedTag.isComponent) context.renders.add(resolvedTag.tag);
    return {
      kind: "element",
      tag: resolvedTag.tag,
      isComponent: resolvedTag.isComponent,
      attributes,
      children,
    };
  };
  const tagVariable = context.locals.get(tag);
  const tagInitializer = tagVariable ? unwrapExpression(tagVariable) : undefined;
  if (tagInitializer && is.isConditionalExpression(tagInitializer)) {
    const whenTrue = resolveTagExpression(tagInitializer.whenTrue, context);
    const whenFalse = resolveTagExpression(tagInitializer.whenFalse, context);
    if (whenTrue && whenFalse) {
      return {
        kind: "branch",
        condition: lowerExpression(tagInitializer.condition, context),
        whenTrue: createElementNode(whenTrue),
        whenFalse: createElementNode(whenFalse),
        span: getSpan(context.sourceFile, tagInitializer.condition),
        probe: "truthy",
      };
    }
  }
  const resolvedTag = (tagInitializer && resolveTagExpression(tagInitializer, context)) || {
    tag,
    isComponent: isComponentTag(tag),
  };
  return createElementNode(resolvedTag);
};

const lowerJsxChildren = (children: readonly Node[], context: ComponentContext): RenderNode[] => {
  const lowered: RenderNode[] = [];
  for (const child of children) {
    if (is.isJsxText(child)) {
      const text = child.text.replace(/\s+/g, " ").trim();
      if (text) lowered.push({ kind: "text", text });
      continue;
    }
    if (is.isJsxExpression(child)) {
      if (child.expression) lowered.push(lowerRender(child.expression, context));
      continue;
    }
    lowered.push(lowerRender(child, context));
  }
  return lowered;
};

const addItemSlots = (callback: Node, context: ComponentContext): void => {
  const parameter = getFunctionParameters(callback)[0];
  if (parameter && is.isParameterDeclaration(parameter))
    addBindingSlots(context, parameter.name, "item", "map");
};

const lowerCallbackRender = (callback: Node, context: ComponentContext): RenderNode => {
  const body = getFunctionBody(callback);
  if (!body)
    return {
      kind: "unknown",
      reason: "list-callback",
      text: getNodeText(context.sourceFile, callback),
    };
  if (is.isBlock(body)) return lowerRenderStatements([...body.statements], context);
  return lowerRender(body, context);
};

export const lowerRender = (rawNode: Node, context: ComponentContext): RenderNode => {
  const node = unwrapExpression(rawNode);
  if (isJsxNode(node)) return lowerJsx(node, context);
  const literal = getLiteralText(node);
  if (literal !== undefined) {
    if (literal === "null" || literal === "undefined" || literal === "false" || literal === "true")
      return { kind: "empty" };
    return { kind: "text", text: literal.startsWith('"') ? JSON.parse(literal) : literal };
  }
  if (is.isConditionalExpression(node)) {
    return {
      kind: "branch",
      condition: lowerExpression(node.condition, context),
      whenTrue: lowerRender(node.whenTrue, context),
      whenFalse: lowerRender(node.whenFalse, context),
      span: getSpan(context.sourceFile, node.condition),
      probe: "truthy",
    };
  }
  if (is.isBinaryExpression(node)) {
    const operator = node.operatorToken.getText(context.sourceFile);
    const left = lowerExpression(node.left, context);
    const span = getSpan(context.sourceFile, node.left);
    if (operator === "&&")
      return {
        kind: "branch",
        condition: left,
        whenTrue: lowerRender(node.right, context),
        whenFalse: { kind: "empty" },
        span,
        probe: "truthy",
      };
    if (operator === "||")
      return {
        kind: "branch",
        condition: left,
        whenTrue: { kind: "value", expression: left },
        whenFalse: lowerRender(node.right, context),
        span,
        probe: "truthy",
      };
    if (operator === "??") {
      return {
        kind: "branch",
        condition: {
          kind: "binary",
          operator: "!=",
          left,
          right: { kind: "literal", text: "null" },
        },
        whenTrue: { kind: "value", expression: left },
        whenFalse: lowerRender(node.right, context),
        span,
        probe: "nullish",
      };
    }
  }
  if (is.isCallExpression(node)) {
    const callee = unwrapExpression(node.expression);
    const callback = node.arguments[0];
    if (
      is.isPropertyAccessExpression(callee) &&
      callee.name.text === "map" &&
      callback &&
      isFunctionNode(unwrapExpression(callback))
    ) {
      const source = lowerExpression(callee.expression, context);
      addItemSlots(unwrapExpression(callback), context);
      return {
        kind: "list",
        source,
        item: lowerCallbackRender(unwrapExpression(callback), context),
      };
    }
    if (
      is.isIdentifier(callee) &&
      context.functions.has(callee.text) &&
      !context.inlineStack.has(callee.text)
    ) {
      const localFunction = context.functions.get(callee.text);
      if (localFunction) {
        context.inlineStack.add(callee.text);
        const rendered = lowerCallbackRender(localFunction, context);
        context.inlineStack.delete(callee.text);
        return rendered;
      }
    }
    const returnType = context.checker.typeToString(
      context.checker.getTypeAtLocation(node) ?? context.checker.getAnyType(),
    );
    if (!/Element|ReactNode|ReactPortal|JSX/.test(returnType))
      return { kind: "value", expression: opaque(context, node, "call") };
    addBailout(context, "render-call", node);
    return { kind: "unknown", reason: "render-call", text: getNodeText(context.sourceFile, node) };
  }
  if (is.isIdentifier(node)) {
    const local = context.locals.get(node.text);
    if (local && !context.inlineStack.has(node.text) && someJsx(local)) {
      context.inlineStack.add(node.text);
      const rendered = lowerRender(local, context);
      context.inlineStack.delete(node.text);
      return rendered;
    }
  }
  return { kind: "value", expression: lowerExpression(node, context) };
};

const someJsx = (node: Node): boolean => isJsxNode(node) || someDescendant(node, isJsxNode);

const flattenStatement = (node: Node | undefined): Statement[] => getStatements(node);

export const lowerRenderStatements = (
  statements: Statement[],
  context: ComponentContext,
): RenderNode => {
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index];
    if (!statement) continue;
    const rest = statements.slice(index + 1);
    if (is.isReturnStatement(statement))
      return statement.expression ? lowerRender(statement.expression, context) : { kind: "empty" };
    if (is.isBlock(statement))
      return lowerRenderStatements([...statement.statements, ...rest], context);
    if (is.isIfStatement(statement) && containsReturn(statement)) {
      return {
        kind: "branch",
        condition: lowerExpression(statement.expression, context),
        whenTrue: lowerRenderStatements(
          [...flattenStatement(statement.thenStatement), ...rest],
          context,
        ),
        whenFalse: lowerRenderStatements(
          [...flattenStatement(statement.elseStatement), ...rest],
          context,
        ),
        span: getSpan(context.sourceFile, statement.expression),
        probe: "truthy",
      };
    }
    if (is.isSwitchStatement(statement) && containsReturn(statement))
      return lowerSwitch(statement, rest, context);
    if (
      is.isTryStatement(statement) ||
      is.isForStatement(statement) ||
      is.isForOfStatement(statement) ||
      is.isWhileStatement(statement)
    ) {
      if (containsReturn(statement)) {
        addBailout(context, "return-in-loop-or-try", statement);
        return {
          kind: "unknown",
          reason: "return-in-loop-or-try",
          text: getNodeText(context.sourceFile, statement).slice(0, 60),
        };
      }
    }
  }
  return { kind: "empty" };
};

const lowerSwitch = (statement: Node, rest: Statement[], context: ComponentContext): RenderNode => {
  if (!is.isSwitchStatement(statement)) return { kind: "empty" };
  const discriminant = lowerExpression(statement.expression, context);
  const clauses = [...statement.caseBlock.clauses];
  const getClauseBody = (startIndex: number): Statement[] => {
    const body: Statement[] = [];
    for (const clause of clauses.slice(startIndex)) {
      for (const clauseStatement of clause.statements) {
        if (is.isBreakStatement(clauseStatement)) return [...body, ...rest];
        body.push(clauseStatement);
      }
      if (clause.statements.some((clauseStatement) => is.isReturnStatement(clauseStatement)))
        return body;
    }
    return [...body, ...rest];
  };
  const defaultIndex = clauses.findIndex((clause) => is.isDefaultClause(clause));
  let result =
    defaultIndex >= 0
      ? lowerRenderStatements(getClauseBody(defaultIndex), context)
      : lowerRenderStatements(rest, context);
  for (let index = clauses.length - 1; index >= 0; index--) {
    const clause = clauses[index];
    if (!clause || !is.isCaseClause(clause)) continue;
    result = {
      kind: "branch",
      condition: {
        kind: "binary",
        operator: "===",
        left: discriminant,
        right: lowerExpression(clause.expression, context),
      },
      whenTrue: lowerRenderStatements(getClauseBody(index), context),
      whenFalse: result,
      span: getSpan(context.sourceFile, clause.expression),
      probe: "none",
    };
  }
  return result;
};

const addSlot = (context: ComponentContext, slot: Slot): void => {
  context.slots.set(slot.name, slot);
  context.atoms.set(slot.name, slot.domain);
};

const addBindingSlots = (
  context: ComponentContext,
  nameNode: Node,
  source: Slot["source"],
  hookName: string,
): void => {
  if (is.isIdentifier(nameNode)) {
    addSlot(context, {
      name: nameNode.text,
      source,
      hookName,
      domain: getDomainAtNode(context.checker, nameNode),
    });
    return;
  }
  if (is.isObjectBindingPattern(nameNode) || is.isArrayBindingPattern(nameNode)) {
    for (const element of nameNode.elements) {
      if (is.isBindingElement(element) && element.name)
        addBindingSlots(context, element.name, source, hookName);
    }
  }
};

const handleHookDeclaration = (
  nameNode: Node,
  hook: HookCall,
  call: Node,
  context: ComponentContext,
): void => {
  if (!is.isCallExpression(call)) return;
  const [firstArgument, secondArgument] = call.arguments;
  const arrayElements = is.isArrayBindingPattern(nameNode)
    ? nameNode.elements.map((element) =>
        is.isBindingElement(element) && element.name && is.isIdentifier(element.name)
          ? element.name
          : undefined,
      )
    : [];
  const [valueName, updaterName] = arrayElements;

  if (hook.isReact && STATE_HOOKS.has(hook.name) && valueName) {
    const initial = firstArgument
      ? lowerExpression(firstArgument, context)
      : { kind: "literal" as const, text: "undefined" };
    addSlot(context, {
      name: valueName.text,
      source: "state",
      hookName: hook.name,
      domain: getDomainAtNode(context.checker, valueName),
      initial,
    });
    if (updaterName) context.setters.set(updaterName.text, valueName.text);
    return;
  }
  if (hook.isReact && hook.name === "useReducer" && valueName) {
    const initial = secondArgument
      ? lowerExpression(secondArgument, context)
      : { kind: "literal" as const, text: "undefined" };
    addSlot(context, {
      name: valueName.text,
      source: "reducer",
      hookName: hook.name,
      domain: getDomainAtNode(context.checker, valueName),
      initial,
    });
    const reducerNode = firstArgument ? unwrapExpression(firstArgument) : undefined;
    const reducer =
      reducerNode && is.isIdentifier(reducerNode)
        ? (context.functions.get(reducerNode.text) ??
          context.moduleDeclarations.get(reducerNode.text))
        : reducerNode;
    if (updaterName)
      context.dispatchers.set(updaterName.text, { stateSlot: valueName.text, reducer });
    return;
  }
  if (
    hook.isReact &&
    (hook.name === "useMemo" || hook.name === "useCallback") &&
    is.isIdentifier(nameNode) &&
    firstArgument
  ) {
    const callback = unwrapExpression(firstArgument);
    if (hook.name === "useCallback") context.functions.set(nameNode.text, callback);
    else {
      const returned = getReturnedExpression(callback);
      if (returned) context.locals.set(nameNode.text, returned);
    }
    return;
  }
  if (hook.isReact && hook.name === "useRef") {
    addBindingSlots(context, nameNode, "ref", hook.name);
    return;
  }
  if (hook.isReact && hook.name === "useActionState" && valueName) {
    addSlot(context, {
      name: valueName.text,
      source: "state",
      hookName: hook.name,
      domain: getDomainAtNode(context.checker, valueName),
    });
    return;
  }
  addBindingSlots(
    context,
    nameNode,
    hook.isReact && hook.name === "useContext" ? "context" : "hook",
    hook.name,
  );
};

const collectDeclarations = (statements: readonly Statement[], context: ComponentContext): void => {
  for (const statement of statements) {
    if (is.isFunctionDeclaration(statement) && statement.name) {
      context.functions.set(statement.name.text, statement);
      continue;
    }
    if (is.isExpressionStatement(statement)) {
      const hook = getHookCall(statement.expression, context);
      const call = unwrapExpression(statement.expression);
      if (
        hook?.isReact &&
        EFFECT_HOOKS.has(hook.name) &&
        is.isCallExpression(call) &&
        call.arguments[0]
      ) {
        const dependencies = call.arguments[1]
          ? getNodeText(context.sourceFile, call.arguments[1])
          : "every render";
        addTransition(
          context,
          `${hook.name}(${dependencies})`,
          unwrapExpression(call.arguments[0]),
          call,
        );
      }
      continue;
    }
    if (!is.isVariableStatement(statement)) {
      if (
        is.isIfStatement(statement) &&
        someDescendant(statement, (child) => getHookCall(child, context) !== undefined)
      )
        addBailout(context, "conditional-hook", statement);
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (!initializer) continue;
      const hook = getHookCall(initializer, context);
      if (hook) {
        handleHookDeclaration(declaration.name, hook, unwrapExpression(initializer), context);
        continue;
      }
      if (!is.isIdentifier(declaration.name)) {
        addBindingSlots(context, declaration.name, "hook", "destructure");
        addBailout(context, "destructured-local", declaration);
        continue;
      }
      const unwrapped = unwrapExpression(initializer);
      if (isFunctionNode(unwrapped)) context.functions.set(declaration.name.text, unwrapped);
      else context.locals.set(declaration.name.text, initializer);
    }
  }
};

const collectProps = (functionNode: Node, context: ComponentContext): void => {
  const parameter = getFunctionParameters(functionNode)[0];
  if (!parameter || !is.isParameterDeclaration(parameter)) return;
  if (is.isObjectBindingPattern(parameter.name)) {
    for (const element of parameter.name.elements) {
      if (
        !is.isBindingElement(element) ||
        element.dotDotDotToken ||
        !element.name ||
        !is.isIdentifier(element.name)
      )
        continue;
      const propType = context.checker.getTypeAtLocation(element.name);
      addSlot(context, {
        name: element.name.text,
        source: "prop",
        propName: element.propertyName?.getText(context.sourceFile) ?? element.name.text,
        domain: getDomainOfType(context.checker, propType),
        samples: getSamples(context.checker, propType),
      });
    }
    return;
  }
  if (!is.isIdentifier(parameter.name)) return;
  context.propsObjectName = parameter.name.text;
  const propsType = context.checker.getTypeAtLocation(parameter.name);
  if (!propsType) return;
  for (const property of context.checker.getPropertiesOfType(propsType)) {
    const propType = context.checker.getTypeOfSymbol(property);
    addSlot(context, {
      name: property.name,
      source: "prop",
      propName: property.name,
      domain: getDomainOfType(context.checker, propType),
      samples: getSamples(context.checker, propType),
    });
  }
};

const isComponentFunction = (functionNode: Node, context: ComponentContext): boolean => {
  const body = getFunctionBody(functionNode);
  if (!body) return false;
  if (isJsxNode(unwrapExpression(body))) return true;
  return someDescendant(
    body,
    (child) => isJsxNode(child) || getHookCall(child, context) !== undefined,
  );
};

const unwrapComponentWrapper = (node: Node, context: ComponentContext): Node | undefined => {
  const unwrapped = unwrapExpression(node);
  if (isFunctionNode(unwrapped)) return unwrapped;
  if (!is.isCallExpression(unwrapped)) return undefined;
  const callee = unwrapped.expression;
  const calleeName = is.isIdentifier(callee)
    ? callee.text
    : is.isPropertyAccessExpression(callee)
      ? callee.name.text
      : "";
  const binding = is.isIdentifier(callee) ? context.imports.get(callee.text) : undefined;
  const isWrapper = COMPONENT_WRAPPERS.has(binding?.importedName ?? calleeName);
  return isWrapper && unwrapped.arguments[0]
    ? unwrapComponentWrapper(unwrapped.arguments[0], context)
    : undefined;
};

const createContext = (
  checker: Checker,
  sourceFile: SourceFile,
  imports: Map<string, ImportBinding>,
  moduleDeclarations: Map<string, Node>,
): ComponentContext => ({
  checker,
  sourceFile,
  imports,
  moduleDeclarations,
  slots: new Map(),
  atoms: new Map(),
  aliases: new Map(),
  propsObjectName: undefined,
  setters: new Map(),
  dispatchers: new Map(),
  locals: new Map(),
  functions: new Map(),
  transitions: [],
  bailouts: [],
  renders: new Set(),
  inlineStack: new Set(),
  eventNames: new Set(),
});

const extractComponent = (
  name: string,
  functionNode: Node,
  context: ComponentContext,
): ComponentModel => {
  collectProps(functionNode, context);
  const body = getFunctionBody(functionNode);
  let render: RenderNode = { kind: "empty" };
  if (body && is.isBlock(body)) {
    collectDeclarations(body.statements, context);
    render = lowerRenderStatements([...body.statements], context);
  } else if (body) {
    render = lowerRender(body, context);
  }
  return {
    name,
    file: context.sourceFile.fileName,
    line: getLine(context.sourceFile, functionNode),
    slots: [...context.slots.values()],
    atoms: context.atoms,
    render,
    transitions: context.transitions,
    renders: [...context.renders],
    bailouts: context.bailouts,
  };
};

const hasModifier = (node: Node, kind: SyntaxKind): boolean =>
  "modifiers" in node &&
  Array.isArray(node.modifiers) &&
  node.modifiers.some((modifier: Node) => modifier.kind === kind);

const collectExportNames = (sourceFile: SourceFile): Map<string, string> => {
  const exportNames = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    const isExported = hasModifier(statement, SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(statement, SyntaxKind.DefaultKeyword);
    if (is.isFunctionDeclaration(statement) && isExported) {
      exportNames.set(
        statement.name?.text ?? "Default",
        isDefault ? "default" : (statement.name?.text ?? "default"),
      );
    }
    if (is.isVariableStatement(statement) && isExported) {
      for (const declaration of statement.declarationList.declarations) {
        if (is.isIdentifier(declaration.name))
          exportNames.set(declaration.name.text, declaration.name.text);
      }
    }
    if (is.isExportAssignment(statement)) {
      const expression = unwrapExpression(statement.expression);
      exportNames.set(is.isIdentifier(expression) ? expression.text : "Default", "default");
    }
    if (
      is.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      is.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const localName =
          element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile);
        exportNames.set(localName, element.name.getText(sourceFile));
      }
    }
  }
  return exportNames;
};

const collectDisplayNames = (sourceFile: SourceFile): Map<string, string> => {
  const displayNames = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!is.isExpressionStatement(statement)) continue;
    const expression = unwrapExpression(statement.expression);
    if (
      !is.isBinaryExpression(expression) ||
      expression.operatorToken.kind !== SyntaxKind.EqualsToken
    )
      continue;
    const target = unwrapExpression(expression.left);
    const value = unwrapExpression(expression.right);
    if (
      is.isPropertyAccessExpression(target) &&
      target.name.text === "displayName" &&
      is.isIdentifier(target.expression) &&
      is.isStringLiteral(value)
    ) {
      displayNames.set(target.expression.text, value.text);
    }
  }
  return displayNames;
};

export const extractComponents = (checker: Checker, sourceFile: SourceFile): ComponentModel[] => {
  const exportNames = collectExportNames(sourceFile);
  const displayNames = collectDisplayNames(sourceFile);
  const imports = collectImports(sourceFile);
  const moduleDeclarations = collectModuleDeclarations(sourceFile);
  const components: ComponentModel[] = [];
  const consider = (name: string, candidate: Node | undefined): void => {
    if (!candidate || !COMPONENT_NAME_PATTERN.test(name)) return;
    const context = createContext(checker, sourceFile, imports, moduleDeclarations);
    const functionNode = unwrapComponentWrapper(candidate, context);
    if (!functionNode || !isComponentFunction(functionNode, context)) return;
    try {
      const exportName = exportNames.get(name);
      const displayName = displayNames.get(name);
      components.push({
        ...extractComponent(name, functionNode, context),
        ...(exportName ? { exportName } : {}),
        ...(displayName ? { displayName } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      components.push({
        name,
        file: sourceFile.fileName,
        line: getLine(sourceFile, functionNode),
        slots: [],
        atoms: new Map(),
        render: { kind: "unknown", reason: "crash", text: message },
        transitions: [],
        renders: [],
        bailouts: [{ reason: "crash", text: message, line: getLine(sourceFile, functionNode) }],
      });
    }
  };
  for (const statement of sourceFile.statements) {
    if (is.isFunctionDeclaration(statement)) consider(statement.name?.text ?? "Default", statement);
    if (is.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (is.isIdentifier(declaration.name))
          consider(declaration.name.text, declaration.initializer);
      }
    }
    if (is.isExportAssignment(statement)) consider("Default", statement.expression);
  }
  return components;
};
