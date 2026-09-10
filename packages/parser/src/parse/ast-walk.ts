import { visitorKeys } from "oxc-parser";
import type {
  Argument,
  AwaitExpression,
  BindingPattern,
  Expression,
  MemberExpression,
  Node,
  ObjectPropertyKind,
  Statement,
  StringLiteral,
  VariableDeclaration,
  YieldExpression,
} from "oxc-parser";
import type { FunctionLikeNode } from "../types.js";

interface ChildNodeVisitor {
  (child: Node, key: string, index: number): void;
}

const isAstNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

export const isFunctionLikeNode = (node: Node): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "ClassDeclaration" ||
  node.type === "ClassExpression";

export const forEachChildNode = (node: Node, visit: ChildNodeVisitor): void => {
  const childKeys = visitorKeys[node.type] ?? [];
  for (const [key, child] of Object.entries(node)) {
    if (!childKeys.includes(key)) continue;
    if (Array.isArray(child)) {
      child.forEach((item, index) => {
        if (isAstNode(item)) visit(item, key, index);
      });
    } else if (isAstNode(child)) {
      visit(child, key, 0);
    }
  }
};

export const getPatternNames = (pattern: BindingPattern): string[] => {
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((property) =>
        getPatternNames(property.type === "RestElement" ? property.argument : property.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((element) =>
        element ? getPatternNames(element.type === "RestElement" ? element.argument : element) : [],
      );
    case "AssignmentPattern":
      return getPatternNames(pattern.left);
  }
};

/** The declaration of `const x = ...` or `export const x = ...`; null for any other statement. */
export const getVariableDeclaration = (statement: Statement): VariableDeclaration | null => {
  if (statement.type === "VariableDeclaration") return statement;
  return statement.type === "ExportNamedDeclaration" &&
    statement.declaration?.type === "VariableDeclaration"
    ? statement.declaration
    : null;
};

export const getDeclaredNames = (declaration: VariableDeclaration): string[] =>
  declaration.declarations.flatMap((declarator) => getPatternNames(declarator.id));

const hoistedVarNamesByBody = new WeakMap<Statement[], string[]>();

/** Names `var` declares anywhere in a function body (nested functions excluded); they belong to the function scope. */
export const getHoistedVarNames = (statements: Statement[]): string[] => {
  const cached = hoistedVarNamesByBody.get(statements);
  if (cached) return cached;
  const names: string[] = [];
  const visit = (node: Node): void => {
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      names.push(...getDeclaredNames(node));
    }
    if (!isFunctionLikeNode(node)) forEachChildNode(node, visit);
  };
  statements.forEach(visit);
  hoistedVarNamesByBody.set(statements, names);
  return names;
};

/** Strips parentheses and TypeScript-only wrappers that do not change the runtime value. */
export const unwrapExpression = (node: Expression): Expression => {
  switch (node.type) {
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "TSInstantiationExpression":
      return unwrapExpression(node.expression);
    default:
      return node;
  }
};

/** An expression an async or generator body suspends at: `await`, or a `yield` that is not `yield*`. */
export type SuspendingExpression = AwaitExpression | YieldExpression;

/** The property name a non-computed member access reads (`#name` for a private field); null when the key is computed. */
export const getStaticMemberKey = (node: MemberExpression): string | null => {
  if (node.property.type === "PrivateIdentifier") return `#${node.property.name}`;
  return !node.computed && node.property.type === "Identifier" ? node.property.name : null;
};

/** Decides which side of a short-circuiting operator runs; null when the source does not decide. */
export interface LeadingAwaitOracle {
  getTruthiness: (expression: Expression) => boolean | null;
  isNullish: (expression: Expression) => boolean | null;
  /** Whether the suspension's outcome is already known, so re-evaluating it replays that outcome. */
  isResolved: (node: SuspendingExpression) => boolean;
}

type LeadingAwaitScan = SuspendingExpression | "pure" | "impure" | "short-circuited";

const scanLeadingAwait = (
  operands: ReadonlyArray<Argument | ObjectPropertyKind | null | undefined>,
  oracle: LeadingAwaitOracle,
): LeadingAwaitScan => {
  for (const operand of operands) {
    if (!operand) continue;
    const scanned =
      operand.type === "SpreadElement"
        ? scanLeadingAwait([operand.argument], oracle)
        : operand.type === "Property"
          ? scanLeadingAwait(
              [
                operand.computed && operand.key.type !== "PrivateIdentifier" ? operand.key : null,
                operand.value,
              ],
              oracle,
            )
          : scanExpressionForLeadingAwait(operand, oracle);
    if (scanned !== "pure") return scanned;
  }
  return "pure";
};

const scanTakenSide = (
  isTaken: boolean | null,
  taken: Expression,
  oracle: LeadingAwaitOracle,
): LeadingAwaitScan =>
  isTaken === null ? "impure" : isTaken ? scanExpressionForLeadingAwait(taken, oracle) : "pure";

const scanExpressionForLeadingAwait = (
  expression: Expression,
  oracle: LeadingAwaitOracle,
): LeadingAwaitScan => {
  const node = unwrapExpression(expression);
  const scan = (operands: ReadonlyArray<Argument | null | undefined>): LeadingAwaitScan =>
    scanLeadingAwait(operands, oracle);
  switch (node.type) {
    case "AwaitExpression":
    case "YieldExpression": {
      if (oracle.isResolved(node)) return "pure";
      if (node.type === "YieldExpression" && node.delegate) return "impure";
      const operand = scan([node.argument]);
      return operand === "pure" ? node : operand;
    }
    case "Literal":
    case "Identifier":
    case "ThisExpression":
    case "Super":
    case "MetaProperty":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "ClassExpression":
      return "pure";
    case "TemplateLiteral":
      return scan(node.expressions);
    case "MemberExpression": {
      const object = scan([node.object]);
      if (object !== "pure") return object;
      if (node.optional) {
        const isNullish = oracle.isNullish(node.object);
        if (isNullish !== false) return isNullish ? "short-circuited" : "impure";
      }
      return scan([node.computed ? node.property : null]);
    }
    case "ChainExpression": {
      const chain = scan([node.expression]);
      return chain === "short-circuited" ? "pure" : chain;
    }
    case "CallExpression": {
      const callee = scan([node.callee]);
      if (callee !== "pure") return callee;
      if (node.optional) {
        const isNullish = oracle.isNullish(node.callee);
        if (isNullish !== false) return isNullish ? "short-circuited" : "impure";
      }
      return scan(node.arguments);
    }
    case "NewExpression":
      return scan([node.callee, ...node.arguments]);
    case "UnaryExpression":
      return node.operator === "delete" ? "impure" : scan([node.argument]);
    case "BinaryExpression":
      return node.left.type === "PrivateIdentifier"
        ? scan([node.right])
        : scan([node.left, node.right]);
    case "LogicalExpression": {
      const left = scan([node.left]);
      if (left !== "pure") return left;
      switch (node.operator) {
        case "&&":
          return scanTakenSide(oracle.getTruthiness(node.left), node.right, oracle);
        case "||": {
          const truthiness = oracle.getTruthiness(node.left);
          return scanTakenSide(truthiness === null ? null : !truthiness, node.right, oracle);
        }
        case "??":
          return scanTakenSide(oracle.isNullish(node.left), node.right, oracle);
      }
    }
    case "ConditionalExpression": {
      const test = scan([node.test]);
      if (test !== "pure") return test;
      const truthiness = oracle.getTruthiness(node.test);
      if (truthiness === null) return "impure";
      return scan([truthiness ? node.consequent : node.alternate]);
    }
    case "SequenceExpression":
      return scan(node.expressions);
    case "ArrayExpression":
      return scan(node.elements);
    case "ObjectExpression":
      return scanLeadingAwait(node.properties, oracle);
    case "AssignmentExpression":
      return node.left.type === "Identifier" || node.left.type === "MemberExpression"
        ? scan([node.left, node.right])
        : "impure";
    default:
      return "impure";
  }
};

/**
 * The first `await` or `yield` a statement evaluates, when everything evaluated
 * before it (names, literals, member reads, function values, decided
 * short-circuits) would evaluate the same way again; null when the statement
 * has no such expression.
 */
export const getLeadingAwait = (
  statement: Statement,
  oracle: LeadingAwaitOracle,
): SuspendingExpression | null => {
  const scan = (expression: Expression | null | undefined): LeadingAwaitScan =>
    expression ? scanExpressionForLeadingAwait(expression, oracle) : "pure";
  const scanned = (() => {
    switch (statement.type) {
      case "ExpressionStatement":
        return scan(statement.expression);
      case "VariableDeclaration":
        return scan(statement.declarations[0]?.init);
      case "ReturnStatement":
        return scan(statement.argument);
      case "ThrowStatement":
        return scan(statement.argument);
      case "IfStatement":
        return scan(statement.test);
      default:
        return "impure";
    }
  })();
  return typeof scanned === "string" ? null : scanned;
};

/** `["a", "b", "c"]` for `a.b.c` (non-computed identifiers only); null for any other shape. */
export const getMemberChain = (node: Expression): string[] | null => {
  const unwrapped = unwrapExpression(node);
  if (unwrapped.type === "Identifier") return [unwrapped.name];
  if (unwrapped.type === "ThisExpression") return ["this"];
  if (unwrapped.type !== "MemberExpression" || unwrapped.computed) return null;
  if (unwrapped.property.type !== "Identifier") return null;
  const objectChain = getMemberChain(unwrapped.object);
  return objectChain ? [...objectChain, unwrapped.property.name] : null;
};

export const isStringLiteralNode = (node: Node | null | undefined): node is StringLiteral =>
  node?.type === "Literal" && typeof node.value === "string";

export const isFunctionLikeExpression = (node: Node | null | undefined): node is FunctionLikeNode =>
  node?.type === "FunctionExpression" || node?.type === "ArrowFunctionExpression";

/** The statements of a function body; null for an arrow with an expression body. */
export const getFunctionStatements = (node: FunctionLikeNode): Statement[] | null => {
  if (!node.body || node.body.type !== "BlockStatement") return null;
  return node.body.body;
};
