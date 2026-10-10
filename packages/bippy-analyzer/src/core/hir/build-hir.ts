/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/BuildHIR.ts at b618bbb.

import type {
  ArrowFunction,
  Block,
  CallExpression,
  ElementAccessExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  JsxChild,
  JsxOpeningElement,
  JsxSelfClosingElement,
  JsxTagNameExpression,
  MethodDeclaration,
  Node,
  PropertyAccessExpression,
  PropertyName,
  NoSubstitutionTemplateLiteral,
  TemplateHead,
  TemplateMiddle,
  TemplateTail,
  TypeNode,
} from "typescript/unstable/ast";
import { NodeFlags, SyntaxKind, formatSyntaxKind } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import {
  CompilerDiagnostic,
  CompilerError,
  CompilerErrorDetail,
  CompilerSuggestionOperation,
  ErrorCategory,
} from "../compiler-error.js";
import { Err, Ok, type Result } from "../utils/result.js";
import type { Environment } from "./environment.js";
import {
  type ArrayExpression,
  type ArrayPattern,
  type BinaryOperator,
  type BlockId,
  type BranchTerminal,
  type BuiltinTag,
  type Case,
  Effect,
  GeneratedSource,
  GotoVariant,
  type HIRFunction,
  type IfTerminal,
  InstructionKind,
  type InstructionValue,
  type JsxAttribute,
  type LogicalOperator,
  type LoweredFunction,
  type ObjectPattern,
  type ObjectProperty,
  type ObjectPropertyKey,
  type Place,
  type PropertyLiteral,
  type ReturnTerminal,
  type SourceLocation,
  type SpreadPattern,
  type ThrowTerminal,
  type Type,
  type UnaryOperator,
  getSourceLocation,
  makeInstructionId,
  makePropertyLiteral,
  makeType,
  promoteTemporary,
  validateIdentifierName,
} from "./hir.js";
import { type Bindings, HIRBuilder, createTemporaryPlace } from "./hir-builder.js";
import { BuiltInArrayId } from "./object-shape.js";
import {
  type IdentifierNode,
  type Scope,
  type ScopeManager,
  isFunctionNode,
  isDestructuringTarget,
  isReferencedIdentifier,
} from "./scope.js";

type LowerableFunction =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration;

type MemberExpressionNode = PropertyAccessExpression | ElementAccessExpression;

interface AssignmentPatternParts {
  left: Node;
  right: Expression;
}

interface PatternFollowup {
  place: Place;
  path: Node;
}

interface HandlerBinding {
  place: Place;
  path: Node;
}

interface LoweredOptionalMemberExpression {
  object: Place;
  value: Place;
}

interface OptionalCallCallee {
  kind: "CallExpression";
  callee: Place;
}

interface OptionalMethodCallee {
  kind: "MethodCall";
  receiver: Place;
  property: Place;
}

type OptionalCallee = OptionalCallCallee | OptionalMethodCallee;

interface LoweredRef<T> {
  current: T | null;
}

interface ObjectPatternProperty {
  node: Node;
  key: PropertyName | null;
  value: Node | null;
  rest: Node | null;
}

const BINARY_OPERATORS: ReadonlyMap<SyntaxKind, BinaryOperator> = new Map([
  [SyntaxKind.PlusToken, "+"],
  [SyntaxKind.MinusToken, "-"],
  [SyntaxKind.SlashToken, "/"],
  [SyntaxKind.PercentToken, "%"],
  [SyntaxKind.AsteriskToken, "*"],
  [SyntaxKind.AsteriskAsteriskToken, "**"],
  [SyntaxKind.AmpersandToken, "&"],
  [SyntaxKind.BarToken, "|"],
  [SyntaxKind.GreaterThanGreaterThanToken, ">>"],
  [SyntaxKind.GreaterThanGreaterThanGreaterThanToken, ">>>"],
  [SyntaxKind.LessThanLessThanToken, "<<"],
  [SyntaxKind.CaretToken, "^"],
  [SyntaxKind.EqualsEqualsToken, "=="],
  [SyntaxKind.EqualsEqualsEqualsToken, "==="],
  [SyntaxKind.ExclamationEqualsToken, "!="],
  [SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
  [SyntaxKind.InKeyword, "in"],
  [SyntaxKind.InstanceOfKeyword, "instanceof"],
  [SyntaxKind.GreaterThanToken, ">"],
  [SyntaxKind.LessThanToken, "<"],
  [SyntaxKind.GreaterThanEqualsToken, ">="],
  [SyntaxKind.LessThanEqualsToken, "<="],
]);

const LOGICAL_OPERATORS: ReadonlyMap<SyntaxKind, LogicalOperator> = new Map([
  [SyntaxKind.BarBarToken, "||"],
  [SyntaxKind.AmpersandAmpersandToken, "&&"],
  [SyntaxKind.QuestionQuestionToken, "??"],
]);

const COMPOUND_ASSIGNMENT_OPERATORS: ReadonlyMap<SyntaxKind, BinaryOperator> = new Map([
  [SyntaxKind.PlusEqualsToken, "+"],
  [SyntaxKind.MinusEqualsToken, "-"],
  [SyntaxKind.SlashEqualsToken, "/"],
  [SyntaxKind.PercentEqualsToken, "%"],
  [SyntaxKind.AsteriskEqualsToken, "*"],
  [SyntaxKind.AsteriskAsteriskEqualsToken, "**"],
  [SyntaxKind.AmpersandEqualsToken, "&"],
  [SyntaxKind.BarEqualsToken, "|"],
  [SyntaxKind.GreaterThanGreaterThanEqualsToken, ">>"],
  [SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ">>>"],
  [SyntaxKind.LessThanLessThanEqualsToken, "<<"],
  [SyntaxKind.CaretEqualsToken, "^"],
]);

const PREFIX_UNARY_OPERATORS: ReadonlyMap<SyntaxKind, UnaryOperator> = new Map([
  [SyntaxKind.MinusToken, "-"],
  [SyntaxKind.PlusToken, "+"],
  [SyntaxKind.ExclamationToken, "!"],
  [SyntaxKind.TildeToken, "~"],
]);

const JSX_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

const getNodeType = (node: Node): string => formatSyntaxKind(node.kind);

const getNodeRange = (node: Node): [number, number] => [node.getStart(), node.getEnd()];

const skipParentheses = (node: Node): Node =>
  t.isParenthesizedExpression(node) ? skipParentheses(node.expression) : node;

const isOptionalChain = (node: Node): boolean => (node.flags & NodeFlags.OptionalChain) !== 0;

const isMemberExpression = (node: Node): node is MemberExpressionNode =>
  (t.isPropertyAccessExpression(node) || t.isElementAccessExpression(node)) &&
  !isOptionalChain(node);

const isOptionalMemberExpression = (node: Node): node is MemberExpressionNode =>
  (t.isPropertyAccessExpression(node) || t.isElementAccessExpression(node)) &&
  isOptionalChain(node);

const isOptionalCallExpression = (node: Node): node is CallExpression =>
  t.isCallExpression(node) && isOptionalChain(node);

const isAssignmentExpression = (node: Node): boolean =>
  t.isBinaryExpression(node) && t.isAssignmentOperator(node.operatorToken.kind);

export const getDirectives = (block: Block): Array<string> => {
  const directives: Array<string> = [];
  for (const statement of block.statements) {
    if (!t.isExpressionStatement(statement) || !t.isStringLiteral(statement.expression)) {
      break;
    }
    directives.push(statement.expression.text);
  }
  return directives;
};

const decodeJsxEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }
    return JSX_ENTITIES.get(name) ?? entity;
  });

const getTemplateValue = (
  node: NoSubstitutionTemplateLiteral | TemplateHead | TemplateMiddle | TemplateTail,
): { raw: string; cooked?: string } => {
  const text = node.getText();
  const raw =
    t.isNoSubstitutionTemplateLiteral(node) || t.isTemplateTail(node)
      ? text.slice(1, -1)
      : text.slice(1, -2);
  return { raw: raw.replace(/\r\n?/g, "\n"), cooked: node.text };
};

const getTypeAnnotation = (node: IdentifierNode): TypeNode | null => {
  const parent = node.parent;
  if (
    (t.isVariableDeclaration(parent) || t.isParameterDeclaration(parent)) &&
    parent.name === node
  ) {
    return parent.type ?? null;
  }
  return null;
};

const getAssignmentPattern = (node: Node): AssignmentPatternParts | null => {
  if (
    (t.isParameterDeclaration(node) || t.isBindingElement(node)) &&
    node.name !== undefined &&
    node.initializer !== undefined
  ) {
    return { left: node.name, right: node.initializer };
  }
  if (t.isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.EqualsToken) {
    return { left: node.left, right: node.right };
  }
  if (t.isShorthandPropertyAssignment(node) && node.objectAssignmentInitializer !== undefined) {
    return { left: node.name, right: node.objectAssignmentInitializer };
  }
  return null;
};

const getRestElementArgument = (node: Node): Node | null => {
  if (t.isSpreadElement(node) || t.isSpreadAssignment(node)) {
    return node.expression;
  }
  if (t.isBindingElement(node) && node.dotDotDotToken !== undefined && node.name !== undefined) {
    return node.name;
  }
  return null;
};

const getArrayPatternElements = (pattern: Node): Array<Node | null> => {
  if (t.isArrayBindingPattern(pattern)) {
    return pattern.elements.map((element) => {
      if (t.isOmittedExpression(element) || element.name === undefined) {
        return null;
      }
      return element.dotDotDotToken !== undefined || element.initializer !== undefined
        ? element
        : element.name;
    });
  }
  if (t.isArrayLiteralExpression(pattern)) {
    return pattern.elements.map((element) => (t.isOmittedExpression(element) ? null : element));
  }
  return [];
};

const getObjectPatternProperties = (pattern: Node): Array<ObjectPatternProperty> => {
  if (t.isObjectBindingPattern(pattern)) {
    return pattern.elements.map((element) => {
      if (element.dotDotDotToken !== undefined || element.name === undefined) {
        return { node: element, key: null, value: null, rest: element.name ?? null };
      }
      const key = element.propertyName ?? (t.isIdentifier(element.name) ? element.name : null);
      return {
        node: element,
        key,
        value: element.initializer !== undefined ? element : element.name,
        rest: null,
      };
    });
  }
  if (t.isObjectLiteralExpression(pattern)) {
    return pattern.properties.map((property) => {
      if (t.isSpreadAssignment(property)) {
        return { node: property, key: null, value: null, rest: property.expression };
      }
      if (t.isPropertyAssignment(property)) {
        return { node: property, key: property.name, value: property.initializer, rest: null };
      }
      if (t.isShorthandPropertyAssignment(property)) {
        return {
          node: property,
          key: property.name,
          value: property.objectAssignmentInitializer !== undefined ? property : property.name,
          rest: null,
        };
      }
      return { node: property, key: null, value: null, rest: null };
    });
  }
  return [];
};

const getSequenceExpressions = (node: Expression): Array<Expression> =>
  t.isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.CommaToken
    ? [...getSequenceExpressions(node.left), node.right]
    : [node];

const getFunctionType = (
  node: LowerableFunction,
): "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration" => {
  if (t.isArrowFunction(node)) {
    return "ArrowFunctionExpression";
  }
  return t.isFunctionDeclaration(node) ? "FunctionDeclaration" : "FunctionExpression";
};

/*
 * *******************************************************************************************
 * *******************************************************************************************
 * ************************************* Lowering to HIR *************************************
 * *******************************************************************************************
 * *******************************************************************************************
 */

/*
 * Converts a function into a high-level intermediate form (HIR) which represents
 * the code as a control-flow graph. All normal control-flow is modeled as accurately
 * as possible to allow precise, expression-level memoization. The main exceptions are
 * try/catch statements and exceptions: we currently bail out (skip compilation) for
 * try/catch and do not attempt to model control flow of exceptions, which can occur
 * ~anywhere in JavaScript. The compiler assumes that exceptions will be handled by
 * the runtime, ie by invalidating memoization.
 */
export const lower = (
  func: LowerableFunction,
  env: Environment,
  // Bindings captured from the outer function, in case lower() is called recursively (for lambdas)
  bindings: Bindings | null = null,
  capturedRefs: Map<IdentifierNode, SourceLocation> = new Map(),
): Result<HIRFunction, CompilerError> => {
  try {
    const hirFunction = lowerFunctionNode(func, env, bindings, capturedRefs);
    return env.hasErrors() ? Err(env.aggregateErrors()) : Ok(hirFunction);
  } catch (error) {
    if (error instanceof CompilerError) {
      return Err(error);
    }
    throw error;
  }
};

const lowerFunctionNode = (
  func: LowerableFunction,
  env: Environment,
  bindings: Bindings | null,
  capturedRefs: Map<IdentifierNode, SourceLocation>,
): HIRFunction => {
  const builder = new HIRBuilder(env, {
    bindings,
    context: capturedRefs,
  });
  const context: HIRFunction["context"] = [];

  for (const [ref, loc] of capturedRefs) {
    context.push({
      kind: "Identifier",
      identifier: builder.resolveBinding(ref),
      effect: Effect.Unknown,
      reactive: false,
      loc,
    });
  }

  let id: string | null = null;
  if ((t.isFunctionDeclaration(func) || t.isFunctionExpression(func)) && func.name !== undefined) {
    id = func.name.text;
  }
  const params: Array<Place | SpreadPattern> = [];
  for (const param of func.parameters) {
    const paramLoc = getSourceLocation(param);
    if (t.isIdentifier(param.name) && param.name.text === "this") {
      continue;
    }
    if (param.dotDotDotToken !== undefined) {
      const place: Place = {
        kind: "Identifier",
        identifier: builder.makeTemporary(paramLoc),
        effect: Effect.Unknown,
        reactive: false,
        loc: paramLoc,
      };
      params.push({
        kind: "Spread",
        place,
      });
      lowerAssignment(builder, paramLoc, InstructionKind.Let, param.name, place, "Assignment");
    } else if (t.isIdentifier(param.name) && param.initializer === undefined) {
      const binding = builder.resolveIdentifier(param.name);
      if (binding.kind !== "Identifier") {
        builder.recordError(
          CompilerDiagnostic.create({
            category: ErrorCategory.Invariant,
            reason: "Could not find binding",
            description: `[BuildHIR] Could not find binding for param \`${param.name.text}\``,
          }).withDetails({
            kind: "error",
            loc: paramLoc,
            message: "Could not find binding",
          }),
        );
        continue;
      }
      const place: Place = {
        kind: "Identifier",
        identifier: binding.identifier,
        effect: Effect.Unknown,
        reactive: false,
        loc: paramLoc,
      };
      params.push(place);
    } else if (t.isBindingPattern(param.name) || param.initializer !== undefined) {
      const place: Place = {
        kind: "Identifier",
        identifier: builder.makeTemporary(paramLoc),
        effect: Effect.Unknown,
        reactive: false,
        loc: paramLoc,
      };
      promoteTemporary(place.identifier);
      params.push(place);
      lowerAssignment(
        builder,
        paramLoc,
        InstructionKind.Let,
        param.initializer !== undefined ? param : param.name,
        place,
        "Assignment",
      );
    } else {
      builder.recordError(
        CompilerDiagnostic.create({
          category: ErrorCategory.Todo,
          reason: `Handle ${getNodeType(param.name)} parameters`,
          description: `[BuildHIR] Add support for ${getNodeType(param.name)} parameters`,
        }).withDetails({
          kind: "error",
          loc: paramLoc,
          message: "Unsupported parameter type",
        }),
      );
    }
  }

  let directives: Array<string> = [];
  const body = func.body;
  if (body !== undefined && t.isBlock(body)) {
    lowerStatement(builder, body);
    directives = getDirectives(body);
  } else if (body !== undefined) {
    const fallthrough = builder.reserve("block");
    const terminal: ReturnTerminal = {
      kind: "return",
      returnVariant: "Implicit",
      loc: GeneratedSource,
      value: lowerExpressionToTemporary(builder, body),
      id: makeInstructionId(0),
      effects: null,
    };
    builder.terminateWithContinuation(terminal, fallthrough);
  } else {
    builder.recordError(
      CompilerDiagnostic.create({
        category: ErrorCategory.Syntax,
        reason: `Unexpected function body kind`,
        description: `Expected function body to be an expression or a block statement, got \`undefined\``,
      }).withDetails({
        kind: "error",
        loc: getSourceLocation(func),
        message: "Expected a block statement or expression",
      }),
    );
  }

  let validatedId: HIRFunction["id"] = null;
  if (id !== null) {
    const idResult = validateIdentifierName(id);
    if (idResult.isErr()) {
      for (const detail of idResult.unwrapErr().details) {
        builder.recordError(detail);
      }
    } else {
      validatedId = idResult.unwrap().value;
    }
  }

  builder.terminate(
    {
      kind: "return",
      returnVariant: "Void",
      loc: GeneratedSource,
      value: lowerValueToTemporary(builder, {
        kind: "Primitive",
        value: undefined,
        loc: GeneratedSource,
      }),
      id: makeInstructionId(0),
      effects: null,
    },
    null,
  );

  const hirBody = builder.build();

  return {
    id: validatedId,
    nameHint: null,
    params,
    fnType: bindings === null ? env.fnType : "Other",
    returnTypeAnnotation: null, // TODO: extract the actual return type node if present
    returns: createTemporaryPlace(env, getSourceLocation(func)),
    body: hirBody,
    context,
    generator: func.asteriskToken !== undefined,
    async: func.modifiers?.some((modifier) => modifier.kind === SyntaxKind.AsyncKeyword) === true,
    loc: getSourceLocation(func),
    env,
    aliasingEffects: null,
    directives,
  };
};

// Helper to lower a statement
const lowerStatement = (builder: HIRBuilder, stmtNode: Node, label: string | null = null): void => {
  const stmtLoc = getSourceLocation(stmtNode);
  if (t.isThrowStatement(stmtNode)) {
    const value = lowerExpressionToTemporary(builder, stmtNode.expression);
    const handler = builder.resolveThrowHandler();
    if (handler !== null) {
      /*
       * NOTE: we could support this, but a `throw` inside try/catch is using exceptions
       * for control-flow and is generally considered an anti-pattern. we can likely
       * just not support this pattern, unless it really becomes necessary for some reason.
       */
      builder.recordError(
        new CompilerErrorDetail({
          reason: "(BuildHIR::lowerStatement) Support ThrowStatement inside of try/catch",
          category: ErrorCategory.Todo,
          loc: stmtLoc,
          suggestions: null,
        }),
      );
    }
    const terminal: ThrowTerminal = {
      kind: "throw",
      value,
      id: makeInstructionId(0),
      loc: stmtLoc,
    };
    builder.terminate(terminal, "block");
    return;
  }
  if (t.isReturnStatement(stmtNode)) {
    const argument = stmtNode.expression;
    const value =
      argument === undefined
        ? lowerValueToTemporary(builder, {
            kind: "Primitive",
            value: undefined,
            loc: GeneratedSource,
          })
        : lowerExpressionToTemporary(builder, argument);
    const terminal: ReturnTerminal = {
      kind: "return",
      returnVariant: "Explicit",
      loc: stmtLoc,
      value,
      id: makeInstructionId(0),
      effects: null,
    };
    builder.terminate(terminal, "block");
    return;
  }
  if (t.isIfStatement(stmtNode)) {
    //  Block for code following the if
    const continuationBlock = builder.reserve("block");
    //  Block for the consequent (if the test is truthy)
    const consequentBlock = builder.enter("block", () => {
      const consequent = stmtNode.thenStatement;
      lowerStatement(builder, consequent);
      return {
        kind: "goto",
        block: continuationBlock.id,
        variant: GotoVariant.Break,
        id: makeInstructionId(0),
        loc: getSourceLocation(consequent),
      };
    });
    //  Block for the alternate (if the test is not truthy)
    let alternateBlock: BlockId;
    const alternate = stmtNode.elseStatement;
    if (alternate !== undefined) {
      alternateBlock = builder.enter("block", () => {
        lowerStatement(builder, alternate);
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: getSourceLocation(alternate),
        };
      });
    } else {
      //  If there is no else clause, use the continuation directly
      alternateBlock = continuationBlock.id;
    }
    const test = lowerExpressionToTemporary(builder, stmtNode.expression);
    const terminal: IfTerminal = {
      kind: "if",
      test,
      consequent: consequentBlock,
      alternate: alternateBlock,
      fallthrough: continuationBlock.id,
      id: makeInstructionId(0),
      loc: stmtLoc,
    };
    builder.terminateWithContinuation(terminal, continuationBlock);
    return;
  }
  if (t.isBlock(stmtNode)) {
    const scopes = builder.environment.scopes;
    const directiveCount = isFunctionNode(stmtNode.parent) ? getDirectives(stmtNode).length : 0;
    const statements = stmtNode.statements.slice(directiveCount);
    const blockScope = scopes.getScope(stmtNode);
    /**
     * Hoistable identifier bindings defined for this precise block
     * scope (excluding bindings from parent or child block scopes).
     */
    const hoistableIdentifiers: Set<IdentifierNode> = new Set();

    for (const [, binding] of blockScope.bindings) {
      // refs to params are always valid / never need to be hoisted
      if (binding.kind !== "param") {
        hoistableIdentifiers.add(binding.identifier);
      }
    }

    for (const statement of statements) {
      const willHoist = new Set<IdentifierNode>();
      /*
       * If we see a hoistable identifier before its declaration, it should be hoisted just
       * before the statement that references it.
       */
      let fnDepth = t.isFunctionDeclaration(statement) ? 1 : 0;
      const visitReferences = (node: Node): void => {
        if (t.isTypeNode(node)) {
          return;
        }
        if (isFunctionNode(node)) {
          fnDepth++;
          node.forEachChild(visitReferences);
          fnDepth--;
          return;
        }
        if (t.isIdentifier(node) && isReferencedIdentifier(node)) {
          const binding = scopes.resolveIdentifier(node);
          /**
           * We can only hoist an identifier decl if
           * 1. the reference occurs within an inner function
           * or
           * 2. the declaration itself is hoistable
           */
          if (
            binding !== null &&
            hoistableIdentifiers.has(binding.identifier) &&
            (fnDepth > 0 || binding.kind === "hoisted")
          ) {
            willHoist.add(node);
          }
        }
        node.forEachChild(visitReferences);
      };
      statement.forEachChild(visitReferences);
      /*
       * After visiting the declaration, hoisting is no longer required
       */
      const visitDeclarations = (node: Node): void => {
        if (t.isIdentifier(node)) {
          hoistableIdentifiers.delete(node);
        }
        node.forEachChild(visitDeclarations);
      };
      statement.forEachChild(visitDeclarations);

      // Hoist declarations that need it to the earliest point where they are needed
      for (const id of willHoist) {
        const binding = scopes.getBinding(blockScope, id.text);
        CompilerError.invariant(binding !== null, {
          reason: "Expected to find binding for hoisted identifier",
          description: `Could not find a binding for ${id.text}`,
          loc: getSourceLocation(id),
        });
        if (builder.environment.isHoistedIdentifier(binding.identifier)) {
          // Already hoisted
          continue;
        }

        let kind:
          | InstructionKind.Let
          | InstructionKind.HoistedConst
          | InstructionKind.HoistedLet
          | InstructionKind.HoistedFunction;
        if (binding.kind === "const" || binding.kind === "var") {
          kind = InstructionKind.HoistedConst;
        } else if (binding.kind === "let") {
          kind = InstructionKind.HoistedLet;
        } else if (t.isFunctionDeclaration(binding.declaration)) {
          kind = InstructionKind.HoistedFunction;
        } else if (!t.isVariableDeclaration(binding.declaration)) {
          builder.recordError(
            new CompilerErrorDetail({
              category: ErrorCategory.Todo,
              reason: "Unsupported declaration type for hoisting",
              description: `variable "${binding.identifier.text}" declared with ${getNodeType(binding.declaration)}`,
              suggestions: null,
              loc: getSourceLocation(id.parent),
            }),
          );
          continue;
        } else {
          builder.recordError(
            new CompilerErrorDetail({
              category: ErrorCategory.Todo,
              reason: "Handle non-const declarations for hoisting",
              description: `variable "${binding.identifier.text}" declared with ${binding.kind}`,
              suggestions: null,
              loc: getSourceLocation(id.parent),
            }),
          );
          continue;
        }

        const identifier = builder.resolveIdentifier(id);
        CompilerError.invariant(identifier.kind === "Identifier", {
          reason: "Expected hoisted binding to be a local identifier, not a global",
          loc: getSourceLocation(id),
        });
        const place: Place = {
          identifier: identifier.identifier,
          kind: "Identifier",
          effect: Effect.Unknown,
          reactive: false,
          loc: getSourceLocation(id),
        };
        lowerValueToTemporary(builder, {
          kind: "DeclareContext",
          lvalue: {
            kind,
            place,
          },
          loc: getSourceLocation(id),
        });
        builder.environment.addHoistedIdentifier(binding.identifier);
      }
      lowerStatement(builder, statement);
    }

    return;
  }
  if (t.isBreakStatement(stmtNode)) {
    const block = builder.lookupBreak(stmtNode.label?.text ?? null);
    builder.terminate(
      {
        kind: "goto",
        block,
        variant: GotoVariant.Break,
        id: makeInstructionId(0),
        loc: stmtLoc,
      },
      "block",
    );
    return;
  }
  if (t.isContinueStatement(stmtNode)) {
    const block = builder.lookupContinue(stmtNode.label?.text ?? null);
    builder.terminate(
      {
        kind: "goto",
        block,
        variant: GotoVariant.Continue,
        id: makeInstructionId(0),
        loc: stmtLoc,
      },
      "block",
    );
    return;
  }
  if (t.isForStatement(stmtNode)) {
    const testBlock = builder.reserve("loop");
    //  Block for code following the loop
    const continuationBlock = builder.reserve("block");

    const initBlock = builder.enter("loop", () => {
      const init = stmtNode.initializer;
      if (init === undefined) {
        /*
         * No init expression (e.g., `for (; ...)`), add a placeholder to avoid
         * invariant about empty blocks
         */
        lowerValueToTemporary(builder, {
          kind: "Primitive",
          value: undefined,
          loc: stmtLoc,
        });
        return {
          kind: "goto",
          block: testBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: stmtLoc,
        };
      }
      if (!t.isVariableDeclarationList(init)) {
        builder.recordError(
          new CompilerErrorDetail({
            reason: "(BuildHIR::lowerStatement) Handle non-variable initialization in ForStatement",
            category: ErrorCategory.Todo,
            loc: stmtLoc,
            suggestions: null,
          }),
        );
        // Lower the init expression as best-effort and continue
        if (t.isExpression(init)) {
          lowerExpressionToTemporary(builder, init);
        }
        return {
          kind: "goto",
          block: testBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: getSourceLocation(init),
        };
      }
      lowerStatement(builder, init);
      return {
        kind: "goto",
        block: testBlock.id,
        variant: GotoVariant.Break,
        id: makeInstructionId(0),
        loc: getSourceLocation(init),
      };
    });

    let updateBlock: BlockId | null = null;
    const update = stmtNode.incrementor;
    if (update !== undefined) {
      updateBlock = builder.enter("loop", () => {
        lowerExpressionToTemporary(builder, update);
        return {
          kind: "goto",
          block: testBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: getSourceLocation(update),
        };
      });
    }

    const bodyBlock = builder.enter("block", () =>
      builder.loop(label, updateBlock ?? testBlock.id, continuationBlock.id, () => {
        const body = stmtNode.statement;
        lowerStatement(builder, body);
        return {
          kind: "goto",
          block: updateBlock ?? testBlock.id,
          variant: GotoVariant.Continue,
          id: makeInstructionId(0),
          loc: getSourceLocation(body),
        };
      }),
    );

    builder.terminateWithContinuation(
      {
        kind: "for",
        loc: stmtLoc,
        init: initBlock,
        test: testBlock.id,
        update: updateBlock,
        loop: bodyBlock,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
      },
      testBlock,
    );

    const test = stmtNode.condition;
    if (test === undefined) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerStatement) Handle empty test in ForStatement`,
          category: ErrorCategory.Todo,
          loc: stmtLoc,
          suggestions: null,
        }),
      );
      // Treat `for(;;)` as `while(true)` to keep the builder state consistent
      builder.terminateWithContinuation(
        {
          kind: "branch",
          test: lowerValueToTemporary(builder, {
            kind: "Primitive",
            value: true,
            loc: stmtLoc,
          }),
          consequent: bodyBlock,
          alternate: continuationBlock.id,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          loc: stmtLoc,
        },
        continuationBlock,
      );
    } else {
      builder.terminateWithContinuation(
        {
          kind: "branch",
          test: lowerExpressionToTemporary(builder, test),
          consequent: bodyBlock,
          alternate: continuationBlock.id,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          loc: stmtLoc,
        },
        continuationBlock,
      );
    }
    return;
  }
  if (t.isWhileStatement(stmtNode)) {
    //  Block used to evaluate whether to (re)enter or exit the loop
    const conditionalBlock = builder.reserve("loop");
    //  Block for code following the loop
    const continuationBlock = builder.reserve("block");
    //  Loop body
    const loopBlock = builder.enter("block", () =>
      builder.loop(label, conditionalBlock.id, continuationBlock.id, () => {
        const body = stmtNode.statement;
        lowerStatement(builder, body);
        return {
          kind: "goto",
          block: conditionalBlock.id,
          variant: GotoVariant.Continue,
          id: makeInstructionId(0),
          loc: getSourceLocation(body),
        };
      }),
    );
    /*
     * The code leading up to the loop must jump to the conditional block,
     * to evaluate whether to enter the loop or bypass to the continuation.
     */
    builder.terminateWithContinuation(
      {
        kind: "while",
        loc: stmtLoc,
        test: conditionalBlock.id,
        loop: loopBlock,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
      },
      conditionalBlock,
    );
    const test = lowerExpressionToTemporary(builder, stmtNode.expression);
    const terminal: BranchTerminal = {
      kind: "branch",
      test,
      consequent: loopBlock,
      alternate: continuationBlock.id,
      fallthrough: conditionalBlock.id,
      id: makeInstructionId(0),
      loc: stmtLoc,
    };
    //  Complete the conditional and continue with code after the loop
    builder.terminateWithContinuation(terminal, continuationBlock);
    return;
  }
  if (t.isLabeledStatement(stmtNode)) {
    const label = stmtNode.label.text;
    const body = stmtNode.statement;
    if (
      t.isForInStatement(body) ||
      t.isForOfStatement(body) ||
      t.isForStatement(body) ||
      t.isWhileStatement(body) ||
      t.isDoStatement(body)
    ) {
      /*
       * labeled loops are special because of continue, so push the label
       * down
       */
      lowerStatement(builder, body, label);
    } else {
      /*
       * All other statements create a continuation block to allow `break`,
       * explicitly *don't* pass the label down
       */
      const continuationBlock = builder.reserve("block");
      const block = builder.enter("block", () => {
        builder.label(label, continuationBlock.id, () => {
          lowerStatement(builder, body);
        });
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: getSourceLocation(body),
        };
      });
      builder.terminateWithContinuation(
        {
          kind: "label",
          block,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          loc: stmtLoc,
        },
        continuationBlock,
      );
    }
    return;
  }
  if (t.isSwitchStatement(stmtNode)) {
    //  Block following the switch
    const continuationBlock = builder.reserve("block");
    /*
     * The goto target for any cases that fallthrough, which initially starts
     * as the continuation block and is then updated as we iterate through cases
     * in reverse order.
     */
    let fallthrough = continuationBlock.id;
    /*
     * Iterate through cases in reverse order, so that previous blocks can fallthrough
     * to successors
     */
    const cases: Array<Case> = [];
    let hasDefault = false;
    const clauses = stmtNode.caseBlock.clauses;
    for (let index = clauses.length - 1; index >= 0; index--) {
      const switchCase = clauses[index];
      if (switchCase === undefined) {
        continue;
      }
      if (t.isDefaultClause(switchCase)) {
        if (hasDefault) {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `Expected at most one \`default\` branch in a switch statement, this code should have failed to parse`,
              category: ErrorCategory.Syntax,
              loc: getSourceLocation(switchCase),
              suggestions: null,
            }),
          );
          break;
        }
        hasDefault = true;
      }
      const block = builder.enter("block", () =>
        builder.switch(label, continuationBlock.id, () => {
          for (const consequent of switchCase.statements) {
            lowerStatement(builder, consequent);
          }
          /*
           * always generate a fallthrough to the next block, this may be dead code
           * if there was an explicit break, but if so it will be pruned later.
           */
          return {
            kind: "goto",
            block: fallthrough,
            variant: GotoVariant.Break,
            id: makeInstructionId(0),
            loc: getSourceLocation(switchCase),
          };
        }),
      );
      let test: Place | null = null;
      if (t.isCaseClause(switchCase)) {
        test = lowerReorderableExpression(builder, switchCase.expression);
      }
      cases.push({
        test,
        block,
      });
      fallthrough = block;
    }
    /*
     * it doesn't matter for our analysis purposes, but reverse the order of the cases
     * back to the original to make it match the original code/intent.
     */
    cases.reverse();
    /*
     * If there wasn't an explicit default case, generate one to model the fact that execution
     * could bypass any of the other cases and jump directly to the continuation.
     */
    if (!hasDefault) {
      cases.push({ test: null, block: continuationBlock.id });
    }

    const test = lowerExpressionToTemporary(builder, stmtNode.expression);
    builder.terminateWithContinuation(
      {
        kind: "switch",
        test,
        cases,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
        loc: stmtLoc,
      },
      continuationBlock,
    );
    return;
  }
  if (t.isVariableStatement(stmtNode) || t.isVariableDeclarationList(stmtNode)) {
    const declarationList = t.isVariableStatement(stmtNode) ? stmtNode.declarationList : stmtNode;
    const blockScopedFlags = declarationList.flags & NodeFlags.BlockScoped;
    const nodeKind =
      blockScopedFlags === NodeFlags.Let
        ? "let"
        : blockScopedFlags === NodeFlags.Const
          ? "const"
          : blockScopedFlags === NodeFlags.Using
            ? "using"
            : blockScopedFlags === NodeFlags.AwaitUsing
              ? "await using"
              : "var";
    if (nodeKind === "var" || nodeKind === "using" || nodeKind === "await using") {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerStatement) Handle ${nodeKind} kinds in VariableDeclaration`,
          category: ErrorCategory.Todo,
          loc: stmtLoc,
          suggestions: null,
        }),
      );
      /*
       * Treat `var` as `let` and `using`/`await using` as `const` so
       * references to the variable don't break while the error unwinds
       */
    }
    const kind =
      nodeKind === "let" || nodeKind === "var" ? InstructionKind.Let : InstructionKind.Const;
    for (const declaration of declarationList.declarations) {
      const id = declaration.name;
      const init = declaration.initializer;
      if (init !== undefined) {
        const value = lowerExpressionToTemporary(builder, init);
        lowerAssignment(
          builder,
          stmtLoc,
          kind,
          id,
          value,
          t.isObjectBindingPattern(id) || t.isArrayBindingPattern(id)
            ? "Destructure"
            : "Assignment",
        );
      } else if (t.isIdentifier(id)) {
        const binding = builder.resolveIdentifier(id);
        if (binding.kind !== "Identifier") {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `(BuildHIR::lowerAssignment) Could not find binding for declaration.`,
              category: ErrorCategory.Invariant,
              loc: getSourceLocation(id),
              suggestions: null,
            }),
          );
        } else {
          const place: Place = {
            identifier: binding.identifier,
            kind: "Identifier",
            effect: Effect.Unknown,
            reactive: false,
            loc: getSourceLocation(id),
          };
          if (builder.isContextIdentifier(id)) {
            if (kind === InstructionKind.Const) {
              const declRangeStart = declarationList.getStart();
              builder.recordError(
                new CompilerErrorDetail({
                  reason: `Expect \`const\` declaration not to be reassigned`,
                  category: ErrorCategory.Syntax,
                  loc: getSourceLocation(id),
                  suggestions: [
                    {
                      description: "Change to a `let` declaration",
                      op: CompilerSuggestionOperation.Replace,
                      range: [declRangeStart, declRangeStart + 5], // "const".length
                      text: "let",
                    },
                  ],
                }),
              );
            }
            lowerValueToTemporary(builder, {
              kind: "DeclareContext",
              lvalue: {
                kind: InstructionKind.Let,
                place,
              },
              loc: getSourceLocation(id),
            });
          } else {
            lowerValueToTemporary(builder, {
              kind: "DeclareLocal",
              lvalue: {
                kind,
                place,
              },
              type: declaration.type ?? null,
              loc: getSourceLocation(id),
            });
          }
        }
      } else {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `Expected variable declaration to be an identifier if no initializer was provided`,
            description: `Got a \`${getNodeType(id)}\``,
            category: ErrorCategory.Syntax,
            loc: stmtLoc,
            suggestions: null,
          }),
        );
      }
    }
    return;
  }
  if (t.isExpressionStatement(stmtNode)) {
    lowerExpressionToTemporary(builder, stmtNode.expression);
    return;
  }
  if (t.isDoStatement(stmtNode)) {
    //  Block used to evaluate whether to (re)enter or exit the loop
    const conditionalBlock = builder.reserve("loop");
    //  Block for code following the loop
    const continuationBlock = builder.reserve("block");
    //  Loop body, executed at least once uncondtionally prior to exit
    const loopBlock = builder.enter("block", () =>
      builder.loop(label, conditionalBlock.id, continuationBlock.id, () => {
        const body = stmtNode.statement;
        lowerStatement(builder, body);
        return {
          kind: "goto",
          block: conditionalBlock.id,
          variant: GotoVariant.Continue,
          id: makeInstructionId(0),
          loc: getSourceLocation(body),
        };
      }),
    );
    /*
     * Jump to the conditional block to evaluate whether to (re)enter the loop or exit to the
     * continuation block.
     */
    builder.terminateWithContinuation(
      {
        kind: "do-while",
        loc: stmtLoc,
        test: conditionalBlock.id,
        loop: loopBlock,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
      },
      conditionalBlock,
    );
    /*
     * The conditional block is empty and exists solely as conditional for
     * (re)entering or exiting the loop
     */
    const test = lowerExpressionToTemporary(builder, stmtNode.expression);
    const terminal: BranchTerminal = {
      kind: "branch",
      test,
      consequent: loopBlock,
      alternate: continuationBlock.id,
      fallthrough: conditionalBlock.id,
      id: makeInstructionId(0),
      loc: stmtLoc,
    };
    //  Complete the conditional and continue with code after the loop
    builder.terminateWithContinuation(terminal, continuationBlock);
    return;
  }
  if (t.isFunctionDeclaration(stmtNode)) {
    if (stmtNode.body === undefined) {
      // We do not preserve type annotations/syntax through transformation
      return;
    }
    const id = stmtNode.name;
    CompilerError.invariant(id !== undefined, {
      reason: "function declarations must have a name",
      loc: stmtLoc,
    });

    const fn = lowerValueToTemporary(builder, lowerFunctionToValue(builder, stmtNode));
    lowerAssignment(builder, stmtLoc, InstructionKind.Function, id, fn, "Assignment");

    return;
  }
  if (t.isForOfStatement(stmtNode)) {
    const continuationBlock = builder.reserve("block");
    const initBlock = builder.reserve("loop");
    const testBlock = builder.reserve("loop");

    if (stmtNode.awaitModifier !== undefined) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerStatement) Handle for-await loops`,
          category: ErrorCategory.Todo,
          loc: stmtLoc,
          suggestions: null,
        }),
      );
      return;
    }

    const loopBlock = builder.enter("block", () =>
      builder.loop(label, initBlock.id, continuationBlock.id, () => {
        const body = stmtNode.statement;
        lowerStatement(builder, body);
        return {
          kind: "goto",
          block: initBlock.id,
          variant: GotoVariant.Continue,
          id: makeInstructionId(0),
          loc: getSourceLocation(body),
        };
      }),
    );

    const value = lowerExpressionToTemporary(builder, stmtNode.expression);
    builder.terminateWithContinuation(
      {
        kind: "for-of",
        loc: stmtLoc,
        init: initBlock.id,
        test: testBlock.id,
        loop: loopBlock,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
      },
      initBlock,
    );

    /*
     * The init of a ForOf statement is compound over a left (VariableDeclaration | LVal) and
     * right (Expression), so we synthesize a new InstrValue and assignment (potentially multiple
     * instructions when we handle other syntax like Patterns)
     */
    const iterator = lowerValueToTemporary(builder, {
      kind: "GetIterator",
      loc: value.loc,
      collection: { ...value },
    });
    builder.terminateWithContinuation(
      {
        id: makeInstructionId(0),
        kind: "goto",
        block: testBlock.id,
        variant: GotoVariant.Break,
        loc: stmtLoc,
      },
      testBlock,
    );

    const left = stmtNode.initializer;
    const leftLoc = getSourceLocation(left);
    let test: Place;
    const advanceIterator = lowerValueToTemporary(builder, {
      kind: "IteratorNext",
      loc: leftLoc,
      iterator: { ...iterator },
      collection: { ...value },
    });
    if (t.isVariableDeclarationList(left)) {
      const declarations = left.declarations;
      const declaration = declarations[0];
      CompilerError.invariant(declarations.length === 1 && declaration !== undefined, {
        reason: `Expected only one declaration in the init of a ForOfStatement, got ${declarations.length}`,
        loc: leftLoc,
      });
      const assign = lowerAssignment(
        builder,
        leftLoc,
        InstructionKind.Let,
        declaration.name,
        advanceIterator,
        "Assignment",
      );
      test = lowerValueToTemporary(builder, assign);
    } else {
      CompilerError.invariant(t.isExpression(left), {
        reason: "Expected ForOf init to be a variable declaration or lval",
        loc: leftLoc,
      });
      const assign = lowerAssignment(
        builder,
        leftLoc,
        InstructionKind.Reassign,
        left,
        advanceIterator,
        "Assignment",
      );
      test = lowerValueToTemporary(builder, assign);
    }
    builder.terminateWithContinuation(
      {
        id: makeInstructionId(0),
        kind: "branch",
        test,
        consequent: loopBlock,
        alternate: continuationBlock.id,
        loc: stmtLoc,
        fallthrough: continuationBlock.id,
      },
      continuationBlock,
    );
    return;
  }
  if (t.isForInStatement(stmtNode)) {
    const continuationBlock = builder.reserve("block");
    const initBlock = builder.reserve("loop");

    const loopBlock = builder.enter("block", () =>
      builder.loop(label, initBlock.id, continuationBlock.id, () => {
        const body = stmtNode.statement;
        lowerStatement(builder, body);
        return {
          kind: "goto",
          block: initBlock.id,
          variant: GotoVariant.Continue,
          id: makeInstructionId(0),
          loc: getSourceLocation(body),
        };
      }),
    );

    const value = lowerExpressionToTemporary(builder, stmtNode.expression);
    builder.terminateWithContinuation(
      {
        kind: "for-in",
        loc: stmtLoc,
        init: initBlock.id,
        loop: loopBlock,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
      },
      initBlock,
    );

    /*
     * The init of a ForIn statement is compound over a left (VariableDeclaration | LVal) and
     * right (Expression), so we synthesize a new InstrValue and assignment (potentially multiple
     * instructions when we handle other syntax like Patterns)
     */
    const left = stmtNode.initializer;
    const leftLoc = getSourceLocation(left);
    let test: Place;
    const nextPropertyTemp = lowerValueToTemporary(builder, {
      kind: "NextPropertyOf",
      loc: leftLoc,
      value,
    });
    if (t.isVariableDeclarationList(left)) {
      const declarations = left.declarations;
      const declaration = declarations[0];
      CompilerError.invariant(declarations.length === 1 && declaration !== undefined, {
        reason: `Expected only one declaration in the init of a ForInStatement, got ${declarations.length}`,
        loc: leftLoc,
      });
      const assign = lowerAssignment(
        builder,
        leftLoc,
        InstructionKind.Let,
        declaration.name,
        nextPropertyTemp,
        "Assignment",
      );
      test = lowerValueToTemporary(builder, assign);
    } else {
      CompilerError.invariant(t.isExpression(left), {
        reason: "Expected ForIn init to be a variable declaration or lval",
        loc: leftLoc,
      });
      const assign = lowerAssignment(
        builder,
        leftLoc,
        InstructionKind.Reassign,
        left,
        nextPropertyTemp,
        "Assignment",
      );
      test = lowerValueToTemporary(builder, assign);
    }
    builder.terminateWithContinuation(
      {
        id: makeInstructionId(0),
        kind: "branch",
        test,
        consequent: loopBlock,
        alternate: continuationBlock.id,
        fallthrough: continuationBlock.id,
        loc: stmtLoc,
      },
      continuationBlock,
    );
    return;
  }
  if (t.isDebuggerStatement(stmtNode)) {
    builder.push({
      id: makeInstructionId(0),
      lvalue: buildTemporaryPlace(builder, stmtLoc),
      value: {
        kind: "Debugger",
        loc: stmtLoc,
      },
      effects: null,
      loc: stmtLoc,
    });
    return;
  }
  if (t.isEmptyStatement(stmtNode)) {
    return;
  }
  if (t.isTryStatement(stmtNode)) {
    const continuationBlock = builder.reserve("block");

    const handlerPath = stmtNode.catchClause;
    if (handlerPath === undefined) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerStatement) Handle TryStatement without a catch clause`,
          category: ErrorCategory.Todo,
          loc: stmtLoc,
          suggestions: null,
        }),
      );
      return;
    }
    if (stmtNode.finallyBlock !== undefined) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause`,
          category: ErrorCategory.Todo,
          loc: stmtLoc,
          suggestions: null,
        }),
      );
    }

    const handlerBindingPath = handlerPath.variableDeclaration?.name;
    let handlerBinding: HandlerBinding | null = null;
    if (handlerBindingPath !== undefined) {
      const handlerBindingLoc = getSourceLocation(handlerBindingPath);
      const place: Place = {
        kind: "Identifier",
        identifier: builder.makeTemporary(handlerBindingLoc),
        effect: Effect.Unknown,
        reactive: false,
        loc: handlerBindingLoc,
      };
      promoteTemporary(place.identifier);
      lowerValueToTemporary(builder, {
        kind: "DeclareLocal",
        lvalue: {
          kind: InstructionKind.Catch,
          place: { ...place },
        },
        type: null,
        loc: handlerBindingLoc,
      });

      handlerBinding = {
        path: handlerBindingPath,
        place,
      };
    }

    const handler = builder.enter("catch", () => {
      if (handlerBinding !== null) {
        lowerAssignment(
          builder,
          getSourceLocation(handlerBinding.path),
          InstructionKind.Catch,
          handlerBinding.path,
          { ...handlerBinding.place },
          "Assignment",
        );
      }
      lowerStatement(builder, handlerPath.block);
      return {
        kind: "goto",
        block: continuationBlock.id,
        variant: GotoVariant.Break,
        id: makeInstructionId(0),
        loc: getSourceLocation(handlerPath),
      };
    });

    const block = builder.enter("block", () => {
      const block = stmtNode.tryBlock;
      builder.enterTryCatch(handler, () => {
        lowerStatement(builder, block);
      });
      return {
        kind: "goto",
        block: continuationBlock.id,
        variant: GotoVariant.Try,
        id: makeInstructionId(0),
        loc: getSourceLocation(block),
      };
    });

    builder.terminateWithContinuation(
      {
        kind: "try",
        block,
        handlerBinding: handlerBinding !== null ? { ...handlerBinding.place } : null,
        handler,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
        loc: stmtLoc,
      },
      continuationBlock,
    );

    return;
  }
  if (t.isWithStatement(stmtNode)) {
    builder.recordError(
      new CompilerErrorDetail({
        reason: `JavaScript 'with' syntax is not supported`,
        description: `'with' syntax is considered deprecated and removed from JavaScript standards, consider alternatives`,
        category: ErrorCategory.UnsupportedSyntax,
        loc: stmtLoc,
        suggestions: null,
      }),
    );
    lowerValueToTemporary(builder, {
      kind: "UnsupportedNode",
      loc: stmtLoc,
      node: stmtNode,
    });
    return;
  }
  if (t.isClassDeclaration(stmtNode)) {
    /**
     * In theory we could support inline class declarations, but this is rare enough in practice
     * and complex enough to support that we don't anticipate supporting anytime soon. Developers
     * are encouraged to lift classes out of component/hook declarations.
     */
    builder.recordError(
      new CompilerErrorDetail({
        reason: "Inline `class` declarations are not supported",
        description: `Move class declarations outside of components/hooks`,
        category: ErrorCategory.UnsupportedSyntax,
        loc: stmtLoc,
        suggestions: null,
      }),
    );
    lowerValueToTemporary(builder, {
      kind: "UnsupportedNode",
      loc: stmtLoc,
      node: stmtNode,
    });
    return;
  }
  if (t.isEnumDeclaration(stmtNode)) {
    lowerValueToTemporary(builder, {
      kind: "UnsupportedNode",
      loc: stmtLoc,
      node: stmtNode,
    });
    return;
  }
  if (
    t.isExportDeclaration(stmtNode) ||
    t.isExportAssignment(stmtNode) ||
    t.isImportDeclaration(stmtNode) ||
    t.isImportEqualsDeclaration(stmtNode)
  ) {
    builder.recordError(
      new CompilerErrorDetail({
        reason:
          "JavaScript `import` and `export` statements may only appear at the top level of a module",
        category: ErrorCategory.Syntax,
        loc: stmtLoc,
        suggestions: null,
      }),
    );
    lowerValueToTemporary(builder, {
      kind: "UnsupportedNode",
      loc: stmtLoc,
      node: stmtNode,
    });
    return;
  }
  if (t.isNamespaceExportDeclaration(stmtNode)) {
    builder.recordError(
      new CompilerErrorDetail({
        reason: "TypeScript `namespace` statements may only appear at the top level of a module",
        category: ErrorCategory.Syntax,
        loc: stmtLoc,
        suggestions: null,
      }),
    );
    lowerValueToTemporary(builder, {
      kind: "UnsupportedNode",
      loc: stmtLoc,
      node: stmtNode,
    });
    return;
  }
  if (
    t.isInterfaceDeclaration(stmtNode) ||
    t.isModuleDeclaration(stmtNode) ||
    t.isTypeAliasDeclaration(stmtNode)
  ) {
    // We do not preserve type annotations/syntax through transformation
    return;
  }
  builder.recordError(
    new CompilerErrorDetail({
      reason: `Unsupported statement kind '${getNodeType(stmtNode)}'`,
      category: ErrorCategory.Todo,
      loc: stmtLoc,
      suggestions: null,
    }),
  );
};

const lowerObjectMethod = (builder: HIRBuilder, property: MethodDeclaration): InstructionValue => {
  const loc = getSourceLocation(property);
  const loweredFunc = lowerFunction(builder, property);

  return {
    kind: "ObjectMethod",
    loc,
    loweredFunc,
  };
};

const lowerObjectPropertyKey = (
  builder: HIRBuilder,
  key: PropertyName,
): ObjectPropertyKey | null => {
  if (t.isStringLiteral(key)) {
    return {
      kind: "string",
      name: key.text,
    };
  }
  if (t.isComputedPropertyName(key)) {
    if (t.isStringLiteral(key.expression)) {
      return {
        kind: "string",
        name: key.expression.text,
      };
    }
    const place = lowerExpressionToTemporary(builder, key.expression);
    return {
      kind: "computed",
      name: place,
    };
  }
  if (t.isIdentifier(key)) {
    return {
      kind: "identifier",
      name: key.text,
    };
  }
  if (t.isNumericLiteral(key)) {
    return {
      kind: "identifier",
      name: String(Number(key.text)),
    };
  }

  builder.recordError(
    new CompilerErrorDetail({
      reason: `(BuildHIR::lowerExpression) Expected Identifier, got ${getNodeType(key)} key in ObjectExpression`,
      category: ErrorCategory.Todo,
      loc: getSourceLocation(key),
      suggestions: null,
    }),
  );
  return null;
};

const lowerExpression = (builder: HIRBuilder, exprNode: Node): InstructionValue => {
  const exprLoc = getSourceLocation(exprNode);
  if (t.isParenthesizedExpression(exprNode)) {
    return lowerExpression(builder, exprNode.expression);
  }
  if (t.isIdentifier(exprNode)) {
    const place = lowerIdentifier(builder, exprNode);
    return {
      kind: getLoadKind(builder, exprNode),
      place,
      loc: exprLoc,
    };
  }
  if (t.isNullLiteral(exprNode)) {
    return {
      kind: "Primitive",
      value: null,
      loc: exprLoc,
    };
  }
  if (t.isTrueLiteral(exprNode) || t.isFalseLiteral(exprNode)) {
    return {
      kind: "Primitive",
      value: t.isTrueLiteral(exprNode),
      loc: exprLoc,
    };
  }
  if (t.isNumericLiteral(exprNode)) {
    return {
      kind: "Primitive",
      value: Number(exprNode.text),
      loc: exprLoc,
    };
  }
  if (t.isStringLiteral(exprNode)) {
    return {
      kind: "Primitive",
      value: t.isJsxAttribute(exprNode.parent) ? decodeJsxEntities(exprNode.text) : exprNode.text,
      loc: exprLoc,
    };
  }
  if (t.isObjectLiteralExpression(exprNode)) {
    const properties: Array<ObjectProperty | SpreadPattern> = [];
    for (const propertyPath of exprNode.properties) {
      if (t.isPropertyAssignment(propertyPath) || t.isShorthandPropertyAssignment(propertyPath)) {
        const loweredKey = lowerObjectPropertyKey(builder, propertyPath.name);
        if (!loweredKey) {
          continue;
        }
        const valuePath = t.isPropertyAssignment(propertyPath)
          ? propertyPath.initializer
          : propertyPath.name;
        const value = lowerExpressionToTemporary(builder, valuePath);
        properties.push({
          kind: "ObjectProperty",
          type: "property",
          place: value,
          key: loweredKey,
        });
      } else if (t.isSpreadAssignment(propertyPath)) {
        const place = lowerExpressionToTemporary(builder, propertyPath.expression);
        properties.push({
          kind: "Spread",
          place,
        });
      } else if (t.isMethodDeclaration(propertyPath)) {
        const method = lowerObjectMethod(builder, propertyPath);
        const place = lowerValueToTemporary(builder, method);
        const loweredKey = lowerObjectPropertyKey(builder, propertyPath.name);
        if (!loweredKey) {
          continue;
        }
        properties.push({
          kind: "ObjectProperty",
          type: "method",
          place,
          key: loweredKey,
        });
      } else if (
        t.isGetAccessorDeclaration(propertyPath) ||
        t.isSetAccessorDeclaration(propertyPath)
      ) {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `(BuildHIR::lowerExpression) Handle ${t.isGetAccessorDeclaration(propertyPath) ? "get" : "set"} functions in ObjectExpression`,
            category: ErrorCategory.Todo,
            loc: getSourceLocation(propertyPath),
            suggestions: null,
          }),
        );
        continue;
      } else {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `(BuildHIR::lowerExpression) Handle ${getNodeType(propertyPath)} properties in ObjectExpression`,
            category: ErrorCategory.Todo,
            loc: getSourceLocation(propertyPath),
            suggestions: null,
          }),
        );
        continue;
      }
    }
    return {
      kind: "ObjectExpression",
      properties,
      loc: exprLoc,
    };
  }
  if (t.isArrayLiteralExpression(exprNode)) {
    const elements: ArrayExpression["elements"] = [];
    for (const element of exprNode.elements) {
      if (t.isOmittedExpression(element)) {
        elements.push({
          kind: "Hole",
        });
        continue;
      } else if (t.isSpreadElement(element)) {
        const place = lowerExpressionToTemporary(builder, element.expression);
        elements.push({ kind: "Spread", place });
      } else {
        elements.push(lowerExpressionToTemporary(builder, element));
      }
    }
    return {
      kind: "ArrayExpression",
      elements,
      loc: exprLoc,
    };
  }
  if (t.isNewExpression(exprNode)) {
    const callee = lowerExpressionToTemporary(builder, exprNode.expression);
    const args = lowerArguments(builder, exprNode.arguments ?? []);

    return {
      kind: "NewExpression",
      callee,
      args,
      loc: exprLoc,
    };
  }
  if (isOptionalCallExpression(exprNode)) {
    return lowerOptionalCallExpression(builder, exprNode, null);
  }
  if (t.isCallExpression(exprNode)) {
    const calleePath = skipParentheses(exprNode.expression);
    if (isMemberExpression(calleePath)) {
      const memberExpr = lowerMemberExpression(builder, calleePath);
      const propertyPlace = lowerValueToTemporary(builder, memberExpr.value);
      const args = lowerArguments(builder, exprNode.arguments);
      return {
        kind: "MethodCall",
        receiver: memberExpr.object,
        property: { ...propertyPlace },
        args,
        loc: exprLoc,
      };
    }
    const callee = lowerExpressionToTemporary(builder, calleePath);
    const args = lowerArguments(builder, exprNode.arguments);
    return {
      kind: "CallExpression",
      callee,
      args,
      loc: exprLoc,
    };
  }
  if (t.isBinaryExpression(exprNode)) {
    const operatorKind = exprNode.operatorToken.kind;
    if (operatorKind === SyntaxKind.CommaToken) {
      const continuationBlock = builder.reserve(builder.currentBlockKind());
      const place = buildTemporaryPlace(builder, exprLoc);

      const sequenceBlock = builder.enter("sequence", () => {
        let last: Place | null = null;
        for (const item of getSequenceExpressions(exprNode)) {
          last = lowerExpressionToTemporary(builder, item);
        }
        if (last === null) {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `Expected sequence expression to have at least one expression`,
              category: ErrorCategory.Syntax,
              loc: exprLoc,
              suggestions: null,
            }),
          );
        } else {
          lowerValueToTemporary(builder, {
            kind: "StoreLocal",
            lvalue: { kind: InstructionKind.Const, place: { ...place } },
            value: last,
            type: null,
            loc: exprLoc,
          });
        }
        return {
          kind: "goto",
          id: makeInstructionId(0),
          block: continuationBlock.id,
          loc: exprLoc,
          variant: GotoVariant.Break,
        };
      });

      builder.terminateWithContinuation(
        {
          kind: "sequence",
          block: sequenceBlock,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          loc: exprLoc,
        },
        continuationBlock,
      );
      return { kind: "LoadLocal", place, loc: place.loc };
    }
    const logicalOperator = LOGICAL_OPERATORS.get(operatorKind);
    if (logicalOperator !== undefined) {
      const continuationBlock = builder.reserve(builder.currentBlockKind());
      const testBlock = builder.reserve("value");
      const place = buildTemporaryPlace(builder, exprLoc);
      const leftPlace = buildTemporaryPlace(builder, getSourceLocation(exprNode.left));
      const consequent = builder.enter("value", () => {
        lowerValueToTemporary(builder, {
          kind: "StoreLocal",
          lvalue: { kind: InstructionKind.Const, place: { ...place } },
          value: { ...leftPlace },
          type: null,
          loc: leftPlace.loc,
        });
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: leftPlace.loc,
        };
      });
      const alternate = builder.enter("value", () => {
        const right = lowerExpressionToTemporary(builder, exprNode.right);
        lowerValueToTemporary(builder, {
          kind: "StoreLocal",
          lvalue: { kind: InstructionKind.Const, place: { ...place } },
          value: { ...right },
          type: null,
          loc: right.loc,
        });
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: right.loc,
        };
      });
      builder.terminateWithContinuation(
        {
          kind: "logical",
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          test: testBlock.id,
          operator: logicalOperator,
          loc: exprLoc,
        },
        testBlock,
      );
      const leftValue = lowerExpressionToTemporary(builder, exprNode.left);
      builder.push({
        id: makeInstructionId(0),
        lvalue: { ...leftPlace },
        value: {
          kind: "LoadLocal",
          place: leftValue,
          loc: exprLoc,
        },
        effects: null,
        loc: exprLoc,
      });
      builder.terminateWithContinuation(
        {
          kind: "branch",
          test: { ...leftPlace },
          consequent,
          alternate,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          loc: exprLoc,
        },
        continuationBlock,
      );
      return { kind: "LoadLocal", place, loc: place.loc };
    }
    if (t.isAssignmentOperator(operatorKind)) {
      const operator = exprNode.operatorToken.getText();

      if (operatorKind === SyntaxKind.EqualsToken) {
        const left = skipParentheses(exprNode.left);
        if (!isOptionalChain(left)) {
          return lowerAssignment(
            builder,
            getSourceLocation(left),
            InstructionKind.Reassign,
            left,
            lowerExpressionToTemporary(builder, exprNode.right),
            t.isArrayLiteralExpression(left) || t.isObjectLiteralExpression(left)
              ? "Destructure"
              : "Assignment",
          );
        }
        /**
         * OptionalMemberExpressions as the left side of an AssignmentExpression are Stage 1 and
         * not supported by React Compiler yet.
         */
        builder.recordError(
          new CompilerErrorDetail({
            reason: `(BuildHIR::lowerExpression) Unsupported syntax on the left side of an AssignmentExpression`,
            description: `Expected an LVal, got: ${getNodeType(left)}`,
            category: ErrorCategory.Todo,
            loc: getSourceLocation(left),
            suggestions: null,
          }),
        );
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }

      const binaryOperator = COMPOUND_ASSIGNMENT_OPERATORS.get(operatorKind);
      if (binaryOperator === undefined) {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `(BuildHIR::lowerExpression) Handle ${operator} operators in AssignmentExpression`,
            category: ErrorCategory.Todo,
            loc: exprLoc,
            suggestions: null,
          }),
        );
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }
      const left = skipParentheses(exprNode.left);
      if (t.isIdentifier(left)) {
        const leftPlace = lowerExpressionToTemporary(builder, left);
        const right = lowerExpressionToTemporary(builder, exprNode.right);
        const binaryPlace = lowerValueToTemporary(builder, {
          kind: "BinaryExpression",
          operator: binaryOperator,
          left: leftPlace,
          right,
          loc: exprLoc,
        });
        const binding = builder.resolveIdentifier(left);
        if (binding.kind === "Identifier") {
          const identifier = lowerIdentifier(builder, left);
          const kind = getStoreKind(builder, left);
          if (kind === "StoreLocal") {
            lowerValueToTemporary(builder, {
              kind: "StoreLocal",
              lvalue: {
                place: { ...identifier },
                kind: InstructionKind.Reassign,
              },
              value: { ...binaryPlace },
              type: null,
              loc: exprLoc,
            });
            return { kind: "LoadLocal", place: identifier, loc: exprLoc };
          }
          lowerValueToTemporary(builder, {
            kind: "StoreContext",
            lvalue: {
              place: { ...identifier },
              kind: InstructionKind.Reassign,
            },
            value: { ...binaryPlace },
            loc: exprLoc,
          });
          return { kind: "LoadContext", place: identifier, loc: exprLoc };
        }
        const temporary = lowerValueToTemporary(builder, {
          kind: "StoreGlobal",
          name: left.text,
          value: { ...binaryPlace },
          loc: exprLoc,
        });
        return { kind: "LoadLocal", place: temporary, loc: temporary.loc };
      }
      if (isMemberExpression(left)) {
        // a.b.c += <right>
        const leftLoc = getSourceLocation(left);
        const loweredMember = lowerMemberExpression(builder, left);
        const object = loweredMember.object;
        const property = loweredMember.property;

        // Store the previous value to a temporary
        const previousValuePlace = lowerValueToTemporary(builder, loweredMember.value);
        // Store the new value to a temporary
        const newValuePlace = lowerValueToTemporary(builder, {
          kind: "BinaryExpression",
          operator: binaryOperator,
          left: { ...previousValuePlace },
          right: lowerExpressionToTemporary(builder, exprNode.right),
          loc: leftLoc,
        });

        // Save the result back to the property
        if (typeof property === "string" || typeof property === "number") {
          return {
            kind: "PropertyStore",
            object: { ...object },
            property: makePropertyLiteral(property),
            value: { ...newValuePlace },
            loc: leftLoc,
          };
        }
        return {
          kind: "ComputedStore",
          object: { ...object },
          property: { ...property },
          value: { ...newValuePlace },
          loc: leftLoc,
        };
      }
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerExpression) Expected Identifier or MemberExpression, got ${getNodeType(left)} lval in AssignmentExpression`,
          category: ErrorCategory.Todo,
          loc: exprLoc,
          suggestions: null,
        }),
      );
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    }
    const leftPath = exprNode.left;
    if (t.isPrivateIdentifier(leftPath)) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerExpression) Expected Expression, got ${getNodeType(leftPath)} lval in BinaryExpression`,
          category: ErrorCategory.Todo,
          loc: getSourceLocation(leftPath),
          suggestions: null,
        }),
      );
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    }
    const left = lowerExpressionToTemporary(builder, leftPath);
    const right = lowerExpressionToTemporary(builder, exprNode.right);
    const operator = BINARY_OPERATORS.get(operatorKind);
    if (operator === undefined) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerExpression) Handle ${exprNode.operatorToken.getText()} operators in BinaryExpression`,
          category: ErrorCategory.Todo,
          loc: getSourceLocation(leftPath),
          suggestions: null,
        }),
      );
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    }
    return {
      kind: "BinaryExpression",
      operator,
      left,
      right,
      loc: exprLoc,
    };
  }
  if (t.isConditionalExpression(exprNode)) {
    //  Block for code following the if
    const continuationBlock = builder.reserve(builder.currentBlockKind());
    const testBlock = builder.reserve("value");
    const place = buildTemporaryPlace(builder, exprLoc);

    //  Block for the consequent (if the test is truthy)
    const consequentBlock = builder.enter("value", () => {
      const consequentPath = exprNode.whenTrue;
      const consequent = lowerExpressionToTemporary(builder, consequentPath);
      lowerValueToTemporary(builder, {
        kind: "StoreLocal",
        lvalue: { kind: InstructionKind.Const, place: { ...place } },
        value: consequent,
        type: null,
        loc: exprLoc,
      });
      return {
        kind: "goto",
        block: continuationBlock.id,
        variant: GotoVariant.Break,
        id: makeInstructionId(0),
        loc: getSourceLocation(consequentPath),
      };
    });
    //  Block for the alternate (if the test is not truthy)
    const alternateBlock = builder.enter("value", () => {
      const alternatePath = exprNode.whenFalse;
      const alternate = lowerExpressionToTemporary(builder, alternatePath);
      lowerValueToTemporary(builder, {
        kind: "StoreLocal",
        lvalue: { kind: InstructionKind.Const, place: { ...place } },
        value: alternate,
        type: null,
        loc: exprLoc,
      });
      return {
        kind: "goto",
        block: continuationBlock.id,
        variant: GotoVariant.Break,
        id: makeInstructionId(0),
        loc: getSourceLocation(alternatePath),
      };
    });

    builder.terminateWithContinuation(
      {
        kind: "ternary",
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
        test: testBlock.id,
        loc: exprLoc,
      },
      testBlock,
    );
    const testPlace = lowerExpressionToTemporary(builder, exprNode.condition);
    builder.terminateWithContinuation(
      {
        kind: "branch",
        test: { ...testPlace },
        consequent: consequentBlock,
        alternate: alternateBlock,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
        loc: exprLoc,
      },
      continuationBlock,
    );
    return { kind: "LoadLocal", place, loc: place.loc };
  }
  if (isOptionalMemberExpression(exprNode)) {
    const value = lowerOptionalMemberExpression(builder, exprNode, null).value;
    return { kind: "LoadLocal", place: value, loc: value.loc };
  }
  if (isMemberExpression(exprNode)) {
    const value = lowerMemberExpression(builder, exprNode).value;
    const place = lowerValueToTemporary(builder, value);
    return { kind: "LoadLocal", place, loc: place.loc };
  }
  if (t.isJsxElement(exprNode) || t.isJsxSelfClosingElement(exprNode)) {
    const opening = t.isJsxElement(exprNode) ? exprNode.openingElement : exprNode;
    const openingLoc = getSourceLocation(opening);
    const tag = lowerJsxElementName(builder, opening.tagName);
    const props: Array<JsxAttribute> = [];
    for (const attribute of opening.attributes.properties) {
      if (t.isJsxSpreadAttribute(attribute)) {
        const argument = lowerExpressionToTemporary(builder, attribute.expression);
        props.push({ kind: "JsxSpreadAttribute", argument });
        continue;
      }
      if (!t.isJsxAttribute(attribute)) {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `(BuildHIR::lowerExpression) Handle ${getNodeType(attribute)} attributes in JSXElement`,
            category: ErrorCategory.Todo,
            loc: getSourceLocation(attribute),
            suggestions: null,
          }),
        );
        continue;
      }
      const namePath = attribute.name;
      let propName;
      if (t.isIdentifier(namePath)) {
        propName = namePath.text;
        if (propName.indexOf(":") !== -1) {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `(BuildHIR::lowerExpression) Unexpected colon in attribute name \`${propName}\``,
              category: ErrorCategory.Todo,
              loc: getSourceLocation(namePath),
              suggestions: null,
            }),
          );
        }
      } else {
        const namespace = namePath.namespace.text;
        const name = namePath.name.text;
        propName = `${namespace}:${name}`;
      }
      const valueExpr = attribute.initializer;
      let value;
      if (
        valueExpr !== undefined &&
        (t.isJsxElement(valueExpr) ||
          t.isJsxSelfClosingElement(valueExpr) ||
          t.isStringLiteral(valueExpr))
      ) {
        value = lowerExpressionToTemporary(builder, valueExpr);
      } else if (valueExpr === undefined) {
        value = lowerValueToTemporary(builder, {
          kind: "Primitive",
          value: true,
          loc: getSourceLocation(attribute),
        });
      } else {
        if (!t.isJsxExpression(valueExpr)) {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `(BuildHIR::lowerExpression) Handle ${getNodeType(valueExpr)} attribute values in JSXElement`,
              category: ErrorCategory.Todo,
              loc: getSourceLocation(valueExpr),
              suggestions: null,
            }),
          );
          continue;
        }
        const expression = valueExpr.expression;
        if (expression === undefined) {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `(BuildHIR::lowerExpression) Handle JSXEmptyExpression expressions in JSXExpressionContainer within JSXElement`,
              category: ErrorCategory.Todo,
              loc: getSourceLocation(valueExpr),
              suggestions: null,
            }),
          );
          continue;
        }
        value = lowerExpressionToTemporary(builder, expression);
      }
      props.push({ kind: "JsxAttribute", name: propName, place: value });
    }

    const isFbt = tag.kind === "BuiltinTag" && (tag.name === "fbt" || tag.name === "fbs");
    if (isFbt) {
      const tagName = tag.name;
      const openingIdentifier = opening.tagName;
      const tagIdentifier = t.isIdentifier(openingIdentifier)
        ? builder.resolveIdentifier(openingIdentifier)
        : null;
      if (tagIdentifier !== null) {
        // This is already checked in builder.resolveIdentifier
        CompilerError.invariant(tagIdentifier.kind !== "Identifier", {
          reason: `<${tagName}> tags should be module-level imports`,
          loc: getSourceLocation(openingIdentifier),
        });
      }
      // see `error.todo-multiple-fbt-plural` fixture for explanation
      const fbtLocations = {
        enum: new Array<SourceLocation>(),
        plural: new Array<SourceLocation>(),
        pronoun: new Array<SourceLocation>(),
      };
      const visitFbt = (node: Node): void => {
        if (t.isJsxClosingElement(node)) {
          return;
        }
        if (t.isJsxNamespacedName(node) && node.namespace.text === tagName) {
          switch (node.name.text) {
            case "enum":
              fbtLocations.enum.push(getSourceLocation(node));
              break;
            case "plural":
              fbtLocations.plural.push(getSourceLocation(node));
              break;
            case "pronoun":
              fbtLocations.pronoun.push(getSourceLocation(node));
              break;
          }
        }
        node.forEachChild(visitFbt);
      };
      exprNode.forEachChild(visitFbt);
      for (const [name, locations] of Object.entries(fbtLocations)) {
        if (locations.length > 1) {
          builder.recordError(
            new CompilerDiagnostic({
              category: ErrorCategory.Todo,
              reason: "Support duplicate fbt tags",
              description: `Support \`<${tagName}>\` tags with multiple \`<${tagName}:${name}>\` values`,
              details: locations.map((loc) => ({
                kind: "error" as const,
                message: `Multiple \`<${tagName}:${name}>\` tags found`,
                loc,
              })),
            }),
          );
        }
      }
    }

    /**
     * Increment fbt counter before traversing into children, as whitespace
     * in jsx text is handled differently for fbt subtrees.
     */
    if (isFbt) {
      builder.fbtDepth++;
    }
    const children: Array<Place> = (t.isJsxElement(exprNode) ? exprNode.children : [])
      .map((child) => lowerJsxElement(builder, child))
      .filter(notNull);
    if (isFbt) {
      builder.fbtDepth--;
    }

    return {
      kind: "JsxExpression",
      tag,
      props,
      children: children.length === 0 ? null : children,
      loc: exprLoc,
      openingLoc: openingLoc,
      closingLoc: t.isJsxElement(exprNode)
        ? getSourceLocation(exprNode.closingElement)
        : GeneratedSource,
    };
  }
  if (t.isJsxFragment(exprNode)) {
    const children: Array<Place> = exprNode.children
      .map((child) => lowerJsxElement(builder, child))
      .filter(notNull);
    return {
      kind: "JsxFragment",
      children,
      loc: exprLoc,
    };
  }
  if (t.isArrowFunction(exprNode) || t.isFunctionExpression(exprNode)) {
    return lowerFunctionToValue(builder, exprNode);
  }
  if (t.isTaggedTemplateExpression(exprNode)) {
    if (!t.isNoSubstitutionTemplateLiteral(exprNode.template)) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: "(BuildHIR::lowerExpression) Handle tagged template with interpolations",
          category: ErrorCategory.Todo,
          loc: exprLoc,
          suggestions: null,
        }),
      );
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    }
    const value = getTemplateValue(exprNode.template);
    if (value.raw !== value.cooked) {
      builder.recordError(
        new CompilerErrorDetail({
          reason:
            "(BuildHIR::lowerExpression) Handle tagged template where cooked value is different from raw value",
          category: ErrorCategory.Todo,
          loc: exprLoc,
          suggestions: null,
        }),
      );
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    }

    return {
      kind: "TaggedTemplateExpression",
      tag: lowerExpressionToTemporary(builder, exprNode.tag),
      value,
      loc: exprLoc,
    };
  }
  if (t.isTemplateExpression(exprNode) || t.isNoSubstitutionTemplateLiteral(exprNode)) {
    const subexprs = t.isTemplateExpression(exprNode)
      ? exprNode.templateSpans.map((span) => span.expression)
      : [];
    const quasis = t.isTemplateExpression(exprNode)
      ? [exprNode.head, ...exprNode.templateSpans.map((span) => span.literal)]
      : [exprNode];

    const subexprPlaces = subexprs.map((subexpr) => lowerExpressionToTemporary(builder, subexpr));

    return {
      kind: "TemplateLiteral",
      subexprs: subexprPlaces,
      quasis: quasis.map((quasi) => getTemplateValue(quasi)),
      loc: exprLoc,
    };
  }
  if (t.isDeleteExpression(exprNode)) {
    const argument = skipParentheses(exprNode.expression);
    if (isMemberExpression(argument)) {
      const loweredMember = lowerMemberExpression(builder, argument);
      const object = loweredMember.object;
      const property = loweredMember.property;
      if (typeof property === "string" || typeof property === "number") {
        return {
          kind: "PropertyDelete",
          object,
          property: makePropertyLiteral(property),
          loc: exprLoc,
        };
      }
      return {
        kind: "ComputedDelete",
        object,
        property,
        loc: exprLoc,
      };
    }
    builder.recordError(
      new CompilerErrorDetail({
        reason: `Only object properties can be deleted`,
        category: ErrorCategory.Syntax,
        loc: exprLoc,
        suggestions: [
          {
            description: "Remove this line",
            range: getNodeRange(exprNode),
            op: CompilerSuggestionOperation.Remove,
          },
        ],
      }),
    );
    return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
  }
  if (t.isTypeOfExpression(exprNode) || t.isVoidExpression(exprNode)) {
    return {
      kind: "UnaryExpression",
      operator: t.isTypeOfExpression(exprNode) ? "typeof" : "void",
      value: lowerExpressionToTemporary(builder, exprNode.expression),
      loc: exprLoc,
    };
  }
  if (t.isPrefixUnaryExpression(exprNode)) {
    const operator = PREFIX_UNARY_OPERATORS.get(exprNode.operator);
    if (operator !== undefined) {
      return {
        kind: "UnaryExpression",
        operator,
        value: lowerExpressionToTemporary(builder, exprNode.operand),
        loc: exprLoc,
      };
    }
  }
  if (t.isAwaitExpression(exprNode)) {
    return {
      kind: "Await",
      value: lowerExpressionToTemporary(builder, exprNode.expression),
      loc: exprLoc,
    };
  }
  if (t.isSatisfiesExpression(exprNode)) {
    const typeAnnotation = exprNode.type;
    return {
      kind: "TypeCastExpression",
      value: lowerExpressionToTemporary(builder, exprNode.expression),
      typeAnnotation,
      typeAnnotationKind: "satisfies",
      type: lowerType(typeAnnotation),
      loc: exprLoc,
    };
  }
  if (t.isAsExpression(exprNode)) {
    const typeAnnotation = exprNode.type;
    return {
      kind: "TypeCastExpression",
      value: lowerExpressionToTemporary(builder, exprNode.expression),
      typeAnnotation,
      typeAnnotationKind: "as",
      type: lowerType(typeAnnotation),
      loc: exprLoc,
    };
  }
  if (t.isPrefixUnaryExpression(exprNode) || t.isPostfixUnaryExpression(exprNode)) {
    const isPrefix = t.isPrefixUnaryExpression(exprNode);
    const updateOperator = exprNode.operator === SyntaxKind.PlusPlusToken ? "++" : "--";
    const argument = skipParentheses(exprNode.operand);
    if (isMemberExpression(argument)) {
      const binaryOperator = updateOperator === "++" ? "+" : "-";
      const leftLoc = getSourceLocation(argument);
      const loweredMember = lowerMemberExpression(builder, argument);
      const object = loweredMember.object;
      const property = loweredMember.property;

      // Store the previous value to a temporary
      const previousValuePlace = lowerValueToTemporary(builder, loweredMember.value);
      // Store the new value to a temporary
      const updatedValue = lowerValueToTemporary(builder, {
        kind: "BinaryExpression",
        operator: binaryOperator,
        left: { ...previousValuePlace },
        right: lowerValueToTemporary(builder, {
          kind: "Primitive",
          value: 1,
          loc: GeneratedSource,
        }),
        loc: leftLoc,
      });

      // Save the result back to the property
      const newValuePlace =
        typeof property === "string" || typeof property === "number"
          ? lowerValueToTemporary(builder, {
              kind: "PropertyStore",
              object: { ...object },
              property: makePropertyLiteral(property),
              value: { ...updatedValue },
              loc: leftLoc,
            })
          : lowerValueToTemporary(builder, {
              kind: "ComputedStore",
              object: { ...object },
              property: { ...property },
              value: { ...updatedValue },
              loc: leftLoc,
            });

      return {
        kind: "LoadLocal",
        place: isPrefix ? { ...newValuePlace } : { ...previousValuePlace },
        loc: exprLoc,
      };
    }
    if (!t.isIdentifier(argument)) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerExpression) Handle UpdateExpression with ${getNodeType(argument)} argument`,
          category: ErrorCategory.Todo,
          loc: exprLoc,
          suggestions: null,
        }),
      );
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    }
    const lvalue = lowerIdentifierForAssignment(
      builder,
      getSourceLocation(argument),
      InstructionKind.Reassign,
      argument,
    );
    if (lvalue === null) {
      /*
       * lowerIdentifierForAssignment should have already reported an error if it returned null,
       * we check here just in case
       */
      if (!builder.environment.hasErrors()) {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `(BuildHIR::lowerExpression) Found an invalid UpdateExpression without a previously reported error`,
            category: ErrorCategory.Invariant,
            loc: exprLoc,
            suggestions: null,
          }),
        );
      }
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    } else if (lvalue.kind === "Global") {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerExpression) Support UpdateExpression where argument is a global`,
          category: ErrorCategory.Todo,
          loc: exprLoc,
          suggestions: null,
        }),
      );
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    }
    const value = lowerIdentifier(builder, argument);
    const isContext = builder.isContextIdentifier(argument);
    if (isPrefix) {
      return {
        kind: isContext ? "PrefixUpdateContext" : "PrefixUpdateLocal",
        lvalue,
        operation: updateOperator,
        value,
        loc: exprLoc,
      };
    }
    return {
      kind: isContext ? "PostfixUpdateContext" : "PostfixUpdateLocal",
      lvalue,
      operation: updateOperator,
      value,
      loc: exprLoc,
    };
  }
  if (t.isRegularExpressionLiteral(exprNode)) {
    const text = exprNode.text;
    const flagsStart = text.lastIndexOf("/");
    return {
      kind: "RegExpLiteral",
      pattern: text.slice(1, flagsStart),
      flags: text.slice(flagsStart + 1),
      loc: exprLoc,
    };
  }
  if (t.isExpressionWithTypeArguments(exprNode) || t.isNonNullExpression(exprNode)) {
    return lowerExpression(builder, exprNode.expression);
  }
  if (t.isMetaProperty(exprNode)) {
    const meta = exprNode.keywordToken === SyntaxKind.ImportKeyword ? "import" : "new";
    if (meta === "import" && exprNode.name.text === "meta") {
      return {
        kind: "MetaProperty",
        meta,
        property: exprNode.name.text,
        loc: exprLoc,
      };
    }

    builder.recordError(
      new CompilerErrorDetail({
        reason: `(BuildHIR::lowerExpression) Handle MetaProperty expressions other than import.meta`,
        category: ErrorCategory.Todo,
        loc: exprLoc,
        suggestions: null,
      }),
    );
    return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
  }
  builder.recordError(
    new CompilerErrorDetail({
      reason: `(BuildHIR::lowerExpression) Handle ${getNodeType(exprNode)} expressions`,
      category: ErrorCategory.Todo,
      loc: exprLoc,
      suggestions: null,
    }),
  );
  return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
};

const lowerOptionalMemberExpression = (
  builder: HIRBuilder,
  expr: MemberExpressionNode,
  parentAlternate: BlockId | null,
): LoweredOptionalMemberExpression => {
  const optional = expr.questionDotToken !== undefined;
  const loc = getSourceLocation(expr);
  const place = buildTemporaryPlace(builder, loc);
  const continuationBlock = builder.reserve(builder.currentBlockKind());
  const consequent = builder.reserve("value");

  /*
   * block to evaluate if the callee is null/undefined, this sets the result of the call to undefined.
   * note that we only create an alternate when first entering an optional subtree of the ast: if this
   * is a child of an optional node, we use the alterate created by the parent.
   */
  const alternate =
    parentAlternate !== null
      ? parentAlternate
      : builder.enter("value", () => {
          const temp = lowerValueToTemporary(builder, {
            kind: "Primitive",
            value: undefined,
            loc,
          });
          lowerValueToTemporary(builder, {
            kind: "StoreLocal",
            lvalue: { kind: InstructionKind.Const, place: { ...place } },
            value: { ...temp },
            type: null,
            loc,
          });
          return {
            kind: "goto",
            variant: GotoVariant.Break,
            block: continuationBlock.id,
            id: makeInstructionId(0),
            loc,
          };
        });

  const object: LoweredRef<Place> = { current: null };
  const testBlock = builder.enter("value", () => {
    const objectPath = expr.expression;
    let loweredObject: Place;
    if (isOptionalMemberExpression(objectPath)) {
      loweredObject = lowerOptionalMemberExpression(builder, objectPath, alternate).value;
    } else if (isOptionalCallExpression(objectPath)) {
      const value = lowerOptionalCallExpression(builder, objectPath, alternate);
      loweredObject = lowerValueToTemporary(builder, value);
    } else {
      loweredObject = lowerExpressionToTemporary(builder, objectPath);
    }
    object.current = loweredObject;
    return {
      kind: "branch",
      test: { ...loweredObject },
      consequent: consequent.id,
      alternate,
      fallthrough: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    };
  });
  const loweredObject = object.current;
  CompilerError.invariant(loweredObject !== null, {
    reason: "Satisfy type checker",
    loc: GeneratedSource,
  });

  /*
   * block to evaluate if the callee is non-null/undefined. arguments are lowered in this block to preserve
   * the semantic of conditional evaluation depending on the callee
   */
  builder.enterReserved(consequent, () => {
    const value = lowerMemberExpression(builder, expr, loweredObject).value;
    const temp = lowerValueToTemporary(builder, value);
    lowerValueToTemporary(builder, {
      kind: "StoreLocal",
      lvalue: { kind: InstructionKind.Const, place: { ...place } },
      value: { ...temp },
      type: null,
      loc,
    });
    return {
      kind: "goto",
      variant: GotoVariant.Break,
      block: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    };
  });

  builder.terminateWithContinuation(
    {
      kind: "optional",
      optional,
      test: testBlock,
      fallthrough: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    },
    continuationBlock,
  );

  return { object: loweredObject, value: place };
};

const lowerOptionalCallExpression = (
  builder: HIRBuilder,
  expr: CallExpression,
  parentAlternate: BlockId | null,
): InstructionValue => {
  const optional = expr.questionDotToken !== undefined;
  const calleePath = expr.expression;
  const loc = getSourceLocation(expr);
  const place = buildTemporaryPlace(builder, loc);
  const continuationBlock = builder.reserve(builder.currentBlockKind());
  const consequent = builder.reserve("value");

  /*
   * block to evaluate if the callee is null/undefined, this sets the result of the call to undefined.
   * note that we only create an alternate when first entering an optional subtree of the ast: if this
   * is a child of an optional node, we use the alterate created by the parent.
   */
  const alternate =
    parentAlternate !== null
      ? parentAlternate
      : builder.enter("value", () => {
          const temp = lowerValueToTemporary(builder, {
            kind: "Primitive",
            value: undefined,
            loc,
          });
          lowerValueToTemporary(builder, {
            kind: "StoreLocal",
            lvalue: { kind: InstructionKind.Const, place: { ...place } },
            value: { ...temp },
            type: null,
            loc,
          });
          return {
            kind: "goto",
            variant: GotoVariant.Break,
            block: continuationBlock.id,
            id: makeInstructionId(0),
            loc,
          };
        });

  /*
   * Lower the callee within the test block to represent the fact that the code for the callee is
   * scoped within the optional
   */
  const callee: LoweredRef<OptionalCallee> = { current: null };
  const testBlock = builder.enter("value", () => {
    let loweredCallee: OptionalCallee;
    if (isOptionalCallExpression(calleePath)) {
      // Recursively call lowerOptionalCallExpression to thread down the alternate block
      const value = lowerOptionalCallExpression(builder, calleePath, alternate);
      const valuePlace = lowerValueToTemporary(builder, value);
      loweredCallee = {
        kind: "CallExpression",
        callee: valuePlace,
      };
    } else if (isOptionalMemberExpression(calleePath)) {
      const loweredMember = lowerOptionalMemberExpression(builder, calleePath, alternate);
      loweredCallee = {
        kind: "MethodCall",
        receiver: loweredMember.object,
        property: loweredMember.value,
      };
    } else if (isMemberExpression(calleePath)) {
      const memberExpr = lowerMemberExpression(builder, calleePath);
      const propertyPlace = lowerValueToTemporary(builder, memberExpr.value);
      loweredCallee = {
        kind: "MethodCall",
        receiver: memberExpr.object,
        property: propertyPlace,
      };
    } else {
      loweredCallee = {
        kind: "CallExpression",
        callee: lowerExpressionToTemporary(builder, calleePath),
      };
    }
    callee.current = loweredCallee;
    const testPlace =
      loweredCallee.kind === "CallExpression" ? loweredCallee.callee : loweredCallee.property;
    return {
      kind: "branch",
      test: { ...testPlace },
      consequent: consequent.id,
      alternate,
      fallthrough: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    };
  });
  const loweredCallee = callee.current;
  CompilerError.invariant(loweredCallee !== null, {
    reason: "Satisfy type checker",
    loc: GeneratedSource,
  });

  /*
   * block to evaluate if the callee is non-null/undefined. arguments are lowered in this block to preserve
   * the semantic of conditional evaluation depending on the callee
   */
  builder.enterReserved(consequent, () => {
    const args = lowerArguments(builder, expr.arguments);
    const temp = buildTemporaryPlace(builder, loc);
    if (loweredCallee.kind === "CallExpression") {
      builder.push({
        id: makeInstructionId(0),
        lvalue: { ...temp },
        value: {
          kind: "CallExpression",
          callee: { ...loweredCallee.callee },
          args,
          loc,
        },
        effects: null,
        loc,
      });
    } else {
      builder.push({
        id: makeInstructionId(0),
        lvalue: { ...temp },
        value: {
          kind: "MethodCall",
          receiver: { ...loweredCallee.receiver },
          property: { ...loweredCallee.property },
          args,
          loc,
        },
        effects: null,
        loc,
      });
    }
    lowerValueToTemporary(builder, {
      kind: "StoreLocal",
      lvalue: { kind: InstructionKind.Const, place: { ...place } },
      value: { ...temp },
      type: null,
      loc,
    });
    return {
      kind: "goto",
      variant: GotoVariant.Break,
      block: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    };
  });

  builder.terminateWithContinuation(
    {
      kind: "optional",
      optional,
      test: testBlock,
      fallthrough: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    },
    continuationBlock,
  );

  return { kind: "LoadLocal", place, loc: place.loc };
};

/*
 * There are a few places where we do not preserve original evaluation ordering and/or control flow, such as
 * switch case test values and default values in destructuring (assignment patterns). In these cases we allow
 * simple expressions whose evaluation cannot be observed:
 *  - primitives
 *  - arrays/objects whose values are also safely reorderable.
 */
const lowerReorderableExpression = (builder: HIRBuilder, expr: Expression): Place => {
  if (!isReorderableExpression(builder, expr, true)) {
    builder.recordError(
      new CompilerErrorDetail({
        reason: `(BuildHIR::node.lowerReorderableExpression) Expression type \`${getNodeType(expr)}\` cannot be safely reordered`,
        category: ErrorCategory.Todo,
        loc: getSourceLocation(expr),
        suggestions: null,
      }),
    );
  }
  return lowerExpressionToTemporary(builder, expr);
};

const isReorderableExpression = (
  builder: HIRBuilder,
  expr: Node,
  allowLocalIdentifiers: boolean,
): boolean => {
  if (t.isIdentifier(expr)) {
    const binding = builder.resolveIdentifier(expr);
    if (binding.kind === "Identifier") {
      return allowLocalIdentifiers;
    }
    // global, definitely safe
    return true;
  }
  if (
    t.isExpressionWithTypeArguments(expr) ||
    t.isParenthesizedExpression(expr) ||
    t.isAsExpression(expr) ||
    t.isNonNullExpression(expr)
  ) {
    return isReorderableExpression(builder, expr.expression, allowLocalIdentifiers);
  }
  if (
    t.isRegularExpressionLiteral(expr) ||
    t.isStringLiteral(expr) ||
    t.isNumericLiteral(expr) ||
    t.isNullLiteral(expr) ||
    t.isTrueLiteral(expr) ||
    t.isFalseLiteral(expr) ||
    t.isBigIntLiteral(expr)
  ) {
    return true;
  }
  if (t.isPrefixUnaryExpression(expr)) {
    switch (expr.operator) {
      case SyntaxKind.ExclamationToken:
      case SyntaxKind.PlusToken:
      case SyntaxKind.MinusToken: {
        return isReorderableExpression(builder, expr.operand, allowLocalIdentifiers);
      }
      default: {
        return false;
      }
    }
  }
  if (t.isBinaryExpression(expr) && LOGICAL_OPERATORS.has(expr.operatorToken.kind)) {
    return (
      isReorderableExpression(builder, expr.left, allowLocalIdentifiers) &&
      isReorderableExpression(builder, expr.right, allowLocalIdentifiers)
    );
  }
  if (t.isConditionalExpression(expr)) {
    return (
      isReorderableExpression(builder, expr.condition, allowLocalIdentifiers) &&
      isReorderableExpression(builder, expr.whenTrue, allowLocalIdentifiers) &&
      isReorderableExpression(builder, expr.whenFalse, allowLocalIdentifiers)
    );
  }
  if (t.isArrayLiteralExpression(expr)) {
    return expr.elements.every(
      (element) =>
        !t.isOmittedExpression(element) &&
        !t.isSpreadElement(element) &&
        isReorderableExpression(builder, element, allowLocalIdentifiers),
    );
  }
  if (t.isObjectLiteralExpression(expr)) {
    return expr.properties.every((property) => {
      if (t.isShorthandPropertyAssignment(property)) {
        return isReorderableExpression(builder, property.name, allowLocalIdentifiers);
      }
      if (!t.isPropertyAssignment(property) || t.isComputedPropertyName(property.name)) {
        return false;
      }
      return isReorderableExpression(builder, property.initializer, allowLocalIdentifiers);
    });
  }
  if (isMemberExpression(expr)) {
    /*
     * A common pattern is switch statements where the case test values are properties of a global,
     * eg `case ProductOptions.Option: { ... }`
     * We therefore allow expressions where the innermost object is a global identifier, and reject
     * all other member expressions (for now).
     */
    let innerObject: Node = expr;
    while (isMemberExpression(innerObject)) {
      innerObject = skipParentheses(innerObject.expression);
    }
    if (
      t.isIdentifier(innerObject) &&
      builder.resolveIdentifier(innerObject).kind !== "Identifier"
    ) {
      // This is a property/computed load from a global, that's safe to reorder
      return true;
    }
    return false;
  }
  if (t.isArrowFunction(expr)) {
    const body = expr.body;
    if (t.isBlock(body)) {
      return body.statements.length === 0;
    }
    // For TypeScript
    return isReorderableExpression(
      builder,
      body,
      /* disallow local identifiers in the body */ false,
    );
  }
  if (t.isCallExpression(expr) && !isOptionalChain(expr)) {
    const callee = expr.expression;
    return (
      isReorderableExpression(builder, callee, allowLocalIdentifiers) &&
      expr.arguments.every(
        (arg) =>
          !t.isSpreadElement(arg) && isReorderableExpression(builder, arg, allowLocalIdentifiers),
      )
    );
  }
  if (t.isNewExpression(expr)) {
    const callee = expr.expression;
    return (
      isReorderableExpression(builder, callee, allowLocalIdentifiers) &&
      (expr.arguments ?? []).every(
        (arg) =>
          !t.isSpreadElement(arg) && isReorderableExpression(builder, arg, allowLocalIdentifiers),
      )
    );
  }
  return false;
};

const lowerArguments = (
  builder: HIRBuilder,
  expr: ReadonlyArray<Expression>,
): Array<Place | SpreadPattern> => {
  const args: Array<Place | SpreadPattern> = [];
  for (const argPath of expr) {
    if (t.isSpreadElement(argPath)) {
      args.push({
        kind: "Spread",
        place: lowerExpressionToTemporary(builder, argPath.expression),
      });
    } else {
      args.push(lowerExpressionToTemporary(builder, argPath));
    }
  }
  return args;
};

interface LoweredMemberExpression {
  object: Place;
  property: Place | string | number;
  value: InstructionValue;
}
const lowerMemberExpression = (
  builder: HIRBuilder,
  expr: MemberExpressionNode,
  loweredObject: Place | null = null,
): LoweredMemberExpression => {
  const exprLoc = getSourceLocation(expr);
  const objectNode = expr.expression;
  const object = loweredObject ?? lowerExpressionToTemporary(builder, objectNode);

  if (t.isPropertyAccessExpression(expr) || t.isNumericLiteral(expr.argumentExpression)) {
    const propertyNode = t.isPropertyAccessExpression(expr) ? expr.name : expr.argumentExpression;
    let property: PropertyLiteral;
    if (t.isIdentifier(propertyNode)) {
      property = makePropertyLiteral(propertyNode.text);
    } else if (t.isNumericLiteral(propertyNode)) {
      property = makePropertyLiteral(Number(propertyNode.text));
    } else {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `(BuildHIR::lowerMemberExpression) Handle ${getNodeType(propertyNode)} property`,
          category: ErrorCategory.Todo,
          loc: getSourceLocation(propertyNode),
          suggestions: null,
        }),
      );
      return {
        object,
        property: propertyNode.getText(),
        value: { kind: "UnsupportedNode", node: expr, loc: exprLoc },
      };
    }
    const value: InstructionValue = {
      kind: "PropertyLoad",
      object: { ...object },
      property,
      loc: exprLoc,
    };
    return { object, property, value };
  }
  const property = lowerExpressionToTemporary(builder, expr.argumentExpression);
  const value: InstructionValue = {
    kind: "ComputedLoad",
    object: { ...object },
    property: { ...property },
    loc: exprLoc,
  };
  return { object, property, value };
};

const lowerJsxElementName = (
  builder: HIRBuilder,
  exprNode: JsxTagNameExpression,
): Place | BuiltinTag => {
  const exprLoc = getSourceLocation(exprNode);
  if (t.isIdentifier(exprNode)) {
    const tag: string = exprNode.text;
    if (!tag.match(/^[a-z]/)) {
      const kind = getLoadKind(builder, exprNode);
      return lowerValueToTemporary(builder, {
        kind: kind,
        place: lowerIdentifier(builder, exprNode),
        loc: exprLoc,
      });
    }
    return {
      kind: "BuiltinTag",
      name: tag,
      loc: exprLoc,
    };
  }
  if (t.isPropertyAccessExpression(exprNode)) {
    return lowerJsxMemberExpression(builder, exprNode);
  }
  if (t.isJsxNamespacedName(exprNode)) {
    const namespace = exprNode.namespace.text;
    const name = exprNode.name.text;
    const tag = `${namespace}:${name}`;
    if (namespace.indexOf(":") !== -1 || name.indexOf(":") !== -1) {
      builder.recordError(
        new CompilerErrorDetail({
          reason: `Expected JSXNamespacedName to have no colons in the namespace or name`,
          description: `Got \`${namespace}\` : \`${name}\``,
          category: ErrorCategory.Syntax,
          loc: exprLoc,
          suggestions: null,
        }),
      );
    }
    const place = lowerValueToTemporary(builder, {
      kind: "Primitive",
      value: tag,
      loc: exprLoc,
    });
    return place;
  }
  builder.recordError(
    new CompilerErrorDetail({
      reason: `(BuildHIR::lowerJsxElementName) Handle ${getNodeType(exprNode)} tags`,
      category: ErrorCategory.Todo,
      loc: exprLoc,
      suggestions: null,
    }),
  );
  return lowerValueToTemporary(builder, {
    kind: "UnsupportedNode",
    node: exprNode,
    loc: exprLoc,
  });
};

const lowerJsxMemberExpression = (
  builder: HIRBuilder,
  exprNode: PropertyAccessExpression,
): Place => {
  const loc = getSourceLocation(exprNode);
  const object = exprNode.expression;
  let objectPlace: Place;
  if (t.isPropertyAccessExpression(object)) {
    objectPlace = lowerJsxMemberExpression(builder, object);
  } else if (t.isThisExpression(object)) {
    objectPlace = lowerValueToTemporary(builder, {
      kind: "LoadGlobal",
      binding: { kind: "Global", name: "this" },
      loc,
    });
  } else {
    CompilerError.invariant(t.isIdentifier(object), {
      reason: `TypeScript refinement fail: expected 'JsxIdentifier', got \`${getNodeType(object)}\``,
      loc: getSourceLocation(object),
    });

    const kind = getLoadKind(builder, object);
    objectPlace = lowerValueToTemporary(builder, {
      kind: kind,
      place: lowerIdentifier(builder, object),
      loc,
    });
  }
  const property = exprNode.name.text;
  return lowerValueToTemporary(builder, {
    kind: "PropertyLoad",
    object: objectPlace,
    property: makePropertyLiteral(property),
    loc,
  });
};

const lowerJsxElement = (builder: HIRBuilder, exprNode: JsxChild): Place | null => {
  const exprLoc = getSourceLocation(exprNode);
  if (
    t.isJsxElement(exprNode) ||
    t.isJsxSelfClosingElement(exprNode) ||
    t.isJsxFragment(exprNode)
  ) {
    return lowerExpressionToTemporary(builder, exprNode);
  }
  if (t.isJsxExpression(exprNode) && exprNode.dotDotDotToken === undefined) {
    const expression = exprNode.expression;
    if (expression === undefined) {
      return null;
    }
    return lowerExpressionToTemporary(builder, expression);
  }
  if (t.isJsxText(exprNode)) {
    let text: string | null;
    const value = decodeJsxEntities(exprNode.text);
    if (builder.fbtDepth > 0) {
      /*
       * FBT whitespace normalization differs from standard JSX.
       * https://github.com/facebook/fbt/blob/0b4e0d13c30bffd0daa2a75715d606e3587b4e40/packages/babel-plugin-fbt/src/FbtUtil.js#L76-L87
       * Since the fbt transform runs after, let's just preserve all
       * whitespace in FBT subtrees as is.
       */
      text = value;
    } else {
      text = trimJsxText(value);
    }

    if (text === null) {
      return null;
    }
    const place = lowerValueToTemporary(builder, {
      kind: "JSXText",
      value: text,
      loc: exprLoc,
    });
    return place;
  }
  builder.recordError(
    new CompilerErrorDetail({
      reason: `(BuildHIR::lowerJsxElement) Unhandled JsxElement, got: ${t.isJsxExpression(exprNode) ? "JSXSpreadChild" : getNodeType(exprNode)}`,
      category: ErrorCategory.Todo,
      loc: exprLoc,
      suggestions: null,
    }),
  );
  const place = lowerValueToTemporary(builder, {
    kind: "UnsupportedNode",
    node: exprNode,
    loc: exprLoc,
  });
  return place;
};

/*
 * Trims whitespace according to the JSX spec:
 * > JSX removes whitespace at the beginning and ending of a line.
 * > It also removes blank lines. New lines adjacent to tags are removed;
 * > new lines that occur in the middle of string literals are condensed
 * > into a single space.
 *
 * From https://legacy.reactjs.org/docs/jsx-in-depth.html#string-literals-1
 *
 * Implementation adapted from Babel:
 * https://github.com/babel/babel/blob/54d30f206057be64b496d2da1ec8c49d244ba4e4/packages/babel-types/src/utils/react/cleanJSXElementLiteralChild.ts#L5
 */
const trimJsxText = (original: string): string | null => {
  const lines = original.split(/\r\n|\n|\r/);

  let lastNonEmptyLine = 0;

  for (let index = 0; index < lines.length; index++) {
    if (lines[index]?.match(/[^ \t]/)) {
      lastNonEmptyLine = index;
    }
  }

  let str = "";

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";

    const isFirstLine = index === 0;
    const isLastLine = index === lines.length - 1;
    const isLastNonEmptyLine = index === lastNonEmptyLine;

    // replace rendered whitespace tabs with spaces
    let trimmedLine = line.replace(/\t/g, " ");

    // trim whitespace touching a newline
    if (!isFirstLine) {
      trimmedLine = trimmedLine.replace(/^[ ]+/, "");
    }

    // trim whitespace touching an endline
    if (!isLastLine) {
      trimmedLine = trimmedLine.replace(/[ ]+$/, "");
    }

    if (trimmedLine) {
      if (!isLastNonEmptyLine) {
        trimmedLine += " ";
      }

      str += trimmedLine;
    }
  }

  if (str.length !== 0) {
    return str;
  }
  return null;
};

const lowerFunctionToValue = (
  builder: HIRBuilder,
  expr: FunctionExpression | ArrowFunction | FunctionDeclaration,
): InstructionValue => {
  const exprLoc = getSourceLocation(expr);
  const loweredFunc = lowerFunction(builder, expr);
  return {
    kind: "FunctionExpression",
    name: loweredFunc.func.id,
    nameHint: null,
    type: getFunctionType(expr),
    loc: exprLoc,
    loweredFunc,
  };
};

const lowerFunction = (builder: HIRBuilder, expr: LowerableFunction): LoweredFunction => {
  const scopes = builder.environment.scopes;
  const componentScope: Scope = scopes.getScope(builder.environment.parentFunction);
  const capturedContext = gatherCapturedContext(expr, componentScope, scopes);

  /*
   * TODO(gsn): In the future, we could only pass in the context identifiers
   * that are actually used by this function and it's nested functions, rather
   * than all context identifiers.
   *
   * This isn't a problem in practice because use Babel's scope analysis to
   * identify the correct references.
   */
  const loweredFunc = lowerFunctionNode(
    expr,
    builder.environment,
    builder.bindings,
    new Map([...builder.context, ...capturedContext]),
  );
  return {
    func: loweredFunc,
  };
};

const lowerExpressionToTemporary = (builder: HIRBuilder, exprPath: Node): Place => {
  const value = lowerExpression(builder, exprPath);
  return lowerValueToTemporary(builder, value);
};

export const lowerValueToTemporary = (builder: HIRBuilder, value: InstructionValue): Place => {
  if (value.kind === "LoadLocal" && value.place.identifier.name === null) {
    return value.place;
  }
  const place: Place = buildTemporaryPlace(builder, value.loc);
  builder.push({
    id: makeInstructionId(0),
    lvalue: { ...place },
    value: value,
    effects: null,
    loc: value.loc,
  });
  return place;
};

const lowerIdentifier = (builder: HIRBuilder, exprNode: IdentifierNode): Place => {
  const exprLoc = getSourceLocation(exprNode);
  const binding = builder.resolveIdentifier(exprNode);
  switch (binding.kind) {
    case "Identifier": {
      const place: Place = {
        kind: "Identifier",
        identifier: binding.identifier,
        effect: Effect.Unknown,
        reactive: false,
        loc: exprLoc,
      };
      return place;
    }
    default: {
      if (binding.kind === "Global" && binding.name === "eval") {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `The 'eval' function is not supported`,
            description:
              "Eval is an anti-pattern in JavaScript, and the code executed cannot be evaluated by React Compiler",
            category: ErrorCategory.UnsupportedSyntax,
            loc: exprLoc,
            suggestions: null,
          }),
        );
      } else if (binding.kind === "Global" && binding.name === "arguments") {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `Implicit 'arguments' is not supported`,
            description:
              "React Compiler does not support compiling functions that reference the implicit arguments object",
            category: ErrorCategory.UnsupportedSyntax,
            loc: exprLoc,
            suggestions: null,
          }),
        );
      }
      return lowerValueToTemporary(builder, {
        kind: "LoadGlobal",
        binding,
        loc: exprLoc,
      });
    }
  }
};

// Creates a temporary Identifier and Place referencing that identifier.
const buildTemporaryPlace = (builder: HIRBuilder, loc: SourceLocation): Place => {
  const place: Place = {
    kind: "Identifier",
    identifier: builder.makeTemporary(loc),
    effect: Effect.Unknown,
    reactive: false,
    loc,
  };
  return place;
};

const getStoreKind = (
  builder: HIRBuilder,
  identifier: IdentifierNode,
): "StoreLocal" | "StoreContext" => {
  const isContext = builder.isContextIdentifier(identifier);
  return isContext ? "StoreContext" : "StoreLocal";
};

const getLoadKind = (
  builder: HIRBuilder,
  identifier: IdentifierNode,
): "LoadLocal" | "LoadContext" => {
  const isContext = builder.isContextIdentifier(identifier);
  return isContext ? "LoadContext" : "LoadLocal";
};

const lowerIdentifierForAssignment = (
  builder: HIRBuilder,
  loc: SourceLocation,
  kind: InstructionKind,
  path: IdentifierNode,
): Place | { kind: "Global"; name: string } | null => {
  const binding = builder.resolveIdentifier(path);
  if (binding.kind !== "Identifier") {
    if (kind === InstructionKind.Reassign) {
      return { kind: "Global", name: path.text };
    }
    // Else its an internal error bc we couldn't find the binding
    builder.recordError(
      new CompilerErrorDetail({
        reason: `(BuildHIR::lowerAssignment) Could not find binding for declaration.`,
        category: ErrorCategory.Invariant,
        loc: getSourceLocation(path),
        suggestions: null,
      }),
    );
    return null;
  } else if (binding.bindingKind === "const" && kind === InstructionKind.Reassign) {
    builder.recordError(
      new CompilerErrorDetail({
        reason: `Cannot reassign a \`const\` variable`,
        category: ErrorCategory.Syntax,
        loc: getSourceLocation(path),
        description:
          binding.identifier.name !== null
            ? `\`${binding.identifier.name.value}\` is declared as const`
            : null,
      }),
    );
    return null;
  }

  const place: Place = {
    kind: "Identifier",
    identifier: binding.identifier,
    effect: Effect.Unknown,
    reactive: false,
    loc,
  };
  return place;
};

const lowerAssignment = (
  builder: HIRBuilder,
  loc: SourceLocation,
  kind: InstructionKind,
  lvaluePath: Node,
  value: Place,
  assignmentKind: "Destructure" | "Assignment",
): InstructionValue => {
  const lvalueNode = skipParentheses(lvaluePath);
  const lvalueLoc = getSourceLocation(lvalueNode);
  if (t.isIdentifier(lvalueNode)) {
    const place = lowerIdentifierForAssignment(builder, loc, kind, lvalueNode);
    if (place === null) {
      return {
        kind: "UnsupportedNode",
        loc: lvalueLoc,
        node: lvalueNode,
      };
    } else if (place.kind === "Global") {
      const temporary = lowerValueToTemporary(builder, {
        kind: "StoreGlobal",
        name: place.name,
        value,
        loc,
      });
      return { kind: "LoadLocal", place: temporary, loc: temporary.loc };
    }
    const isHoistedIdentifier = builder.environment.isHoistedIdentifier(lvalueNode);

    let temporary;
    if (builder.isContextIdentifier(lvalueNode)) {
      if (kind === InstructionKind.Const && !isHoistedIdentifier) {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `Expected \`const\` declaration not to be reassigned`,
            category: ErrorCategory.Syntax,
            loc: lvalueLoc,
            suggestions: null,
          }),
        );
      }

      if (
        kind !== InstructionKind.Const &&
        kind !== InstructionKind.Reassign &&
        kind !== InstructionKind.Let &&
        kind !== InstructionKind.Function
      ) {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `Unexpected context variable kind`,
            category: ErrorCategory.Syntax,
            loc: lvalueLoc,
            suggestions: null,
          }),
        );
        temporary = lowerValueToTemporary(builder, {
          kind: "UnsupportedNode",
          node: lvalueNode,
          loc: lvalueLoc,
        });
      } else {
        temporary = lowerValueToTemporary(builder, {
          kind: "StoreContext",
          lvalue: { place: { ...place }, kind },
          value,
          loc,
        });
      }
    } else {
      temporary = lowerValueToTemporary(builder, {
        kind: "StoreLocal",
        lvalue: { place: { ...place }, kind },
        value,
        type: getTypeAnnotation(lvalueNode),
        loc,
      });
    }
    return { kind: "LoadLocal", place: temporary, loc: temporary.loc };
  }
  if (isMemberExpression(lvalueNode)) {
    // This can only occur because of a coding error, parsers enforce this condition
    CompilerError.invariant(kind === InstructionKind.Reassign, {
      reason: "MemberExpression may only appear in an assignment expression",
      loc: lvalueLoc,
    });
    const object = lowerExpressionToTemporary(builder, lvalueNode.expression);
    if (
      t.isPropertyAccessExpression(lvalueNode) ||
      t.isNumericLiteral(lvalueNode.argumentExpression)
    ) {
      const property = t.isPropertyAccessExpression(lvalueNode)
        ? lvalueNode.name
        : lvalueNode.argumentExpression;
      let temporary;
      if (t.isIdentifier(property)) {
        temporary = lowerValueToTemporary(builder, {
          kind: "PropertyStore",
          object,
          property: makePropertyLiteral(property.text),
          value,
          loc,
        });
      } else if (t.isNumericLiteral(property)) {
        temporary = lowerValueToTemporary(builder, {
          kind: "PropertyStore",
          object,
          property: makePropertyLiteral(Number(property.text)),
          value,
          loc,
        });
      } else {
        builder.recordError(
          new CompilerErrorDetail({
            reason: `(BuildHIR::lowerAssignment) Handle ${getNodeType(property)} properties in MemberExpression`,
            category: ErrorCategory.Todo,
            loc: getSourceLocation(property),
            suggestions: null,
          }),
        );
        return { kind: "UnsupportedNode", node: lvalueNode, loc };
      }
      return { kind: "LoadLocal", place: temporary, loc: temporary.loc };
    }
    const propertyPlace = lowerExpressionToTemporary(builder, lvalueNode.argumentExpression);
    const temporary = lowerValueToTemporary(builder, {
      kind: "ComputedStore",
      object,
      property: propertyPlace,
      value,
      loc,
    });
    return { kind: "LoadLocal", place: temporary, loc: temporary.loc };
  }
  if (t.isArrayBindingPattern(lvalueNode) || t.isArrayLiteralExpression(lvalueNode)) {
    const elements = getArrayPatternElements(lvalueNode);
    const items: ArrayPattern["items"] = [];
    const followups: Array<PatternFollowup> = [];
    /*
     * A given destructuring statement must contain all declarations or all
     * reassignments. This is enforced by the parser, but we rewrite nested
     * destructuring into assignment to a temporary. Therefore, if we see
     * any reassignments that are nested destructuring we fall back to
     * using temporaries for all variables, and emitting the actual reassignments
     * in follow-up statements
     */
    const forceTemporaries =
      kind === InstructionKind.Reassign &&
      (elements.some((element) => element === null || !t.isIdentifier(skipParentheses(element))) ||
        elements.some((element) => {
          const identifier = element !== null ? skipParentheses(element) : null;
          return (
            identifier !== null &&
            t.isIdentifier(identifier) &&
            (getStoreKind(builder, identifier) !== "StoreLocal" ||
              builder.resolveIdentifier(identifier).kind !== "Identifier")
          );
        }));
    for (const element of elements) {
      if (element === null) {
        items.push({
          kind: "Hole",
        });
        continue;
      }
      const elementLoc = getSourceLocation(element);
      const restArgument = getRestElementArgument(element);
      const identifierElement = skipParentheses(element);
      if (restArgument !== null) {
        const argument = skipParentheses(restArgument);
        if (
          t.isIdentifier(argument) &&
          !forceTemporaries &&
          (assignmentKind === "Assignment" || getStoreKind(builder, argument) === "StoreLocal")
        ) {
          const identifier = lowerIdentifierForAssignment(builder, elementLoc, kind, argument);
          if (identifier === null) {
            continue;
          } else if (identifier.kind === "Global") {
            builder.recordError(
              new CompilerErrorDetail({
                category: ErrorCategory.Todo,
                reason: "Expected reassignment of globals to enable forceTemporaries",
                loc: elementLoc,
              }),
            );
            continue;
          }
          items.push({
            kind: "Spread",
            place: identifier,
          });
        } else {
          const temp = buildTemporaryPlace(builder, elementLoc);
          promoteTemporary(temp.identifier);
          items.push({
            kind: "Spread",
            place: { ...temp },
          });
          followups.push({ place: temp, path: argument });
        }
      } else if (
        t.isIdentifier(identifierElement) &&
        !forceTemporaries &&
        (assignmentKind === "Assignment" ||
          getStoreKind(builder, identifierElement) === "StoreLocal")
      ) {
        const identifier = lowerIdentifierForAssignment(
          builder,
          elementLoc,
          kind,
          identifierElement,
        );
        if (identifier === null) {
          continue;
        } else if (identifier.kind === "Global") {
          builder.recordError(
            new CompilerErrorDetail({
              category: ErrorCategory.Todo,
              reason: "Expected reassignment of globals to enable forceTemporaries",
              loc: elementLoc,
            }),
          );
          continue;
        }
        items.push(identifier);
      } else {
        const temp = buildTemporaryPlace(builder, elementLoc);
        promoteTemporary(temp.identifier);
        items.push({ ...temp });
        followups.push({ place: temp, path: element });
      }
    }
    const temporary = lowerValueToTemporary(builder, {
      kind: "Destructure",
      lvalue: {
        kind,
        pattern: {
          kind: "ArrayPattern",
          items,
          loc: lvalueLoc,
        },
      },
      value,
      loc,
    });
    for (const followup of followups) {
      lowerAssignment(
        builder,
        getSourceLocation(followup.path),
        kind,
        followup.path,
        followup.place,
        assignmentKind,
      );
    }
    return { kind: "LoadLocal", place: temporary, loc: value.loc };
  }
  if (t.isObjectBindingPattern(lvalueNode) || t.isObjectLiteralExpression(lvalueNode)) {
    const propertiesPaths = getObjectPatternProperties(lvalueNode);
    const properties: ObjectPattern["properties"] = [];
    const followups: Array<PatternFollowup> = [];
    /*
     * A given destructuring statement must contain all declarations or all
     * reassignments. This is enforced by the parser, but we rewrite nested
     * destructuring into assignment to a temporary. Therefore, if we see
     * any reassignments that are nested destructuring we fall back to
     * using temporaries for all variables, and emitting the actual reassignments
     * in follow-up statements
     */
    const forceTemporaries =
      kind === InstructionKind.Reassign &&
      propertiesPaths.some((property) => {
        if (property.rest !== null) {
          return true;
        }
        if (property.value === null) {
          return false;
        }
        const propertyValue = skipParentheses(property.value);
        return (
          !t.isIdentifier(propertyValue) ||
          builder.resolveIdentifier(propertyValue).kind !== "Identifier"
        );
      });
    for (const property of propertiesPaths) {
      const propertyLoc = getSourceLocation(property.node);
      if (property.rest !== null) {
        const argument = skipParentheses(property.rest);
        if (!t.isIdentifier(argument)) {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `(BuildHIR::lowerAssignment) Handle ${getNodeType(argument)} rest element in ObjectPattern`,
              category: ErrorCategory.Todo,
              loc: getSourceLocation(argument),
              suggestions: null,
            }),
          );
          continue;
        }
        if (forceTemporaries || getStoreKind(builder, argument) === "StoreContext") {
          const temp = buildTemporaryPlace(builder, propertyLoc);
          promoteTemporary(temp.identifier);
          properties.push({
            kind: "Spread",
            place: { ...temp },
          });
          followups.push({ place: temp, path: argument });
        } else {
          const identifier = lowerIdentifierForAssignment(builder, propertyLoc, kind, argument);
          if (identifier === null) {
            continue;
          } else if (identifier.kind === "Global") {
            builder.recordError(
              new CompilerErrorDetail({
                category: ErrorCategory.Todo,
                reason: "Expected reassignment of globals to enable forceTemporaries",
                loc: propertyLoc,
              }),
            );
            continue;
          }
          properties.push({
            kind: "Spread",
            place: identifier,
          });
        }
      } else {
        // TODO: this should always be true given the if/else
        if (property.key === null || property.value === null) {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `(BuildHIR::lowerAssignment) Handle ${getNodeType(property.node)} properties in ObjectPattern`,
              category: ErrorCategory.Todo,
              loc: propertyLoc,
              suggestions: null,
            }),
          );
          continue;
        }
        if (t.isComputedPropertyName(property.key)) {
          builder.recordError(
            new CompilerErrorDetail({
              reason: `(BuildHIR::lowerAssignment) Handle computed properties in ObjectPattern`,
              category: ErrorCategory.Todo,
              loc: propertyLoc,
              suggestions: null,
            }),
          );
          continue;
        }
        const loweredKey = lowerObjectPropertyKey(builder, property.key);
        if (!loweredKey) {
          continue;
        }
        const element = property.value;
        const elementLoc = getSourceLocation(element);
        const identifierElement = skipParentheses(element);
        if (
          t.isIdentifier(identifierElement) &&
          !forceTemporaries &&
          (assignmentKind === "Assignment" ||
            getStoreKind(builder, identifierElement) === "StoreLocal")
        ) {
          const identifier = lowerIdentifierForAssignment(
            builder,
            elementLoc,
            kind,
            identifierElement,
          );
          if (identifier === null) {
            continue;
          } else if (identifier.kind === "Global") {
            builder.recordError(
              new CompilerErrorDetail({
                category: ErrorCategory.Todo,
                reason: "Expected reassignment of globals to enable forceTemporaries",
                loc: elementLoc,
              }),
            );
            continue;
          }
          properties.push({
            kind: "ObjectProperty",
            type: "property",
            place: identifier,
            key: loweredKey,
          });
        } else {
          const temp = buildTemporaryPlace(builder, elementLoc);
          promoteTemporary(temp.identifier);
          properties.push({
            kind: "ObjectProperty",
            type: "property",
            place: { ...temp },
            key: loweredKey,
          });
          followups.push({ place: temp, path: element });
        }
      }
    }
    const temporary = lowerValueToTemporary(builder, {
      kind: "Destructure",
      lvalue: {
        kind,
        pattern: {
          kind: "ObjectPattern",
          properties,
          loc: lvalueLoc,
        },
      },
      value,
      loc,
    });
    for (const followup of followups) {
      lowerAssignment(
        builder,
        getSourceLocation(followup.path),
        kind,
        followup.path,
        followup.place,
        assignmentKind,
      );
    }
    return { kind: "LoadLocal", place: temporary, loc: value.loc };
  }
  const assignmentPattern = getAssignmentPattern(lvalueNode);
  if (assignmentPattern !== null) {
    const loc = lvalueLoc;
    const temp = buildTemporaryPlace(builder, loc);

    const testBlock = builder.reserve("value");
    const continuationBlock = builder.reserve(builder.currentBlockKind());

    const consequent = builder.enter("value", () => {
      /*
       * Because we reorder evaluation, we restrict the allowed default values to those where
       * evaluation order is unobservable
       */
      const defaultValue = lowerReorderableExpression(builder, assignmentPattern.right);
      lowerValueToTemporary(builder, {
        kind: "StoreLocal",
        lvalue: { kind: InstructionKind.Const, place: { ...temp } },
        value: { ...defaultValue },
        type: null,
        loc,
      });
      return {
        kind: "goto",
        variant: GotoVariant.Break,
        block: continuationBlock.id,
        id: makeInstructionId(0),
        loc,
      };
    });

    const alternate = builder.enter("value", () => {
      lowerValueToTemporary(builder, {
        kind: "StoreLocal",
        lvalue: { kind: InstructionKind.Const, place: { ...temp } },
        value: { ...value },
        type: null,
        loc,
      });
      return {
        kind: "goto",
        variant: GotoVariant.Break,
        block: continuationBlock.id,
        id: makeInstructionId(0),
        loc,
      };
    });
    builder.terminateWithContinuation(
      {
        kind: "ternary",
        test: testBlock.id,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
        loc,
      },
      testBlock,
    );
    const undef = lowerValueToTemporary(builder, {
      kind: "Primitive",
      value: undefined,
      loc,
    });
    const test = lowerValueToTemporary(builder, {
      kind: "BinaryExpression",
      left: { ...value },
      operator: "===",
      right: { ...undef },
      loc,
    });
    builder.terminateWithContinuation(
      {
        kind: "branch",
        test: { ...test },
        consequent,
        alternate,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
        loc,
      },
      continuationBlock,
    );

    return lowerAssignment(builder, loc, kind, assignmentPattern.left, temp, assignmentKind);
  }
  builder.recordError(
    new CompilerErrorDetail({
      reason: `(BuildHIR::lowerAssignment) Handle ${getNodeType(lvalueNode)} assignments`,
      category: ErrorCategory.Todo,
      loc: lvalueLoc,
      suggestions: null,
    }),
  );
  return { kind: "UnsupportedNode", node: lvalueNode, loc };
};

const captureScopes = (scopeRange: { from: Scope | null; to: Scope }): Set<Scope> => {
  const scopes: Set<Scope> = new Set();
  let from = scopeRange.from;
  while (from) {
    scopes.add(from);

    if (from === scopeRange.to) {
      break;
    }

    from = from.parent;
  }
  return scopes;
};

/**
 * Returns a mapping of "context" identifiers — references to free variables that
 * will become part of the function expression's `context` array — along with the
 * source location of their first reference within the function.
 */
const gatherCapturedContext = (
  fn: LowerableFunction,
  componentScope: Scope,
  scopeManager: ScopeManager,
): Map<IdentifierNode, SourceLocation> => {
  const capturedIds = new Map<IdentifierNode, SourceLocation>();

  /*
   * Capture all the scopes from the parent of this function up to and including
   * the component scope.
   */
  const pureScopes: Set<Scope> = captureScopes({
    from: scopeManager.getScope(fn).parent,
    to: componentScope,
  });

  const handleMaybeDependency = (
    path: IdentifierNode | JsxOpeningElement | JsxSelfClosingElement,
  ): void => {
    // Base context variable to depend on
    let baseIdentifier: IdentifierNode;
    if (t.isJsxOpeningElement(path) || t.isJsxSelfClosingElement(path)) {
      const name = path.tagName;
      if (!(t.isPropertyAccessExpression(name) || t.isIdentifier(name))) {
        // TODO: should JSX namespaced names be handled here as well?
        return;
      }
      let current: Node = name;
      while (t.isPropertyAccessExpression(current)) {
        current = current.expression;
      }
      if (!t.isIdentifier(current)) {
        return;
      }
      baseIdentifier = current;
    } else {
      baseIdentifier = path;
    }

    // Add the base identifier binding as a dependency.
    const binding = scopeManager.resolveIdentifier(baseIdentifier);
    if (binding !== null && pureScopes.has(binding.scope) && !capturedIds.has(binding.identifier)) {
      capturedIds.set(binding.identifier, getSourceLocation(path));
    }
  };

  const visit = (node: Node): void => {
    if (t.isTypeNode(node) || t.isTypeAliasDeclaration(node) || t.isInterfaceDeclaration(node)) {
      return;
    }
    // A destructuring default, `[a = 1] = b`, is an `AssignmentPattern` to Babel.
    if (
      t.isBinaryExpression(node) &&
      isAssignmentExpression(node) &&
      !isDestructuringTarget(node)
    ) {
      /*
       * Babel has a bug where it doesn't visit the LHS of an
       * AssignmentExpression if it's an Identifier. Work around it by explicitly
       * visiting it.
       */
      const left = skipParentheses(node.left);
      if (t.isIdentifier(left)) {
        handleMaybeDependency(left);
      }
    } else if (t.isJsxElement(node)) {
      handleMaybeDependency(node.openingElement);
    } else if (t.isJsxSelfClosingElement(node)) {
      handleMaybeDependency(node);
    } else if (t.isIdentifier(node) && isReferencedIdentifier(node)) {
      handleMaybeDependency(node);
    }
    node.forEachChild(visit);
  };
  fn.forEachChild(visit);

  return capturedIds;
};

const notNull = <T>(value: T | null): value is T => value !== null;

export const lowerType = (node: TypeNode): Type => {
  if (t.isTypeReferenceNode(node)) {
    const typeName = node.typeName;
    if (t.isIdentifier(typeName) && typeName.text === "Array") {
      return { kind: "Object", shapeId: BuiltInArrayId };
    }
    return makeType();
  }
  if (t.isArrayTypeNode(node)) {
    return { kind: "Object", shapeId: BuiltInArrayId };
  }
  if (t.isLiteralTypeNode(node) && t.isNullLiteral(node.literal)) {
    return { kind: "Primitive" };
  }
  switch (node.kind) {
    case SyntaxKind.BooleanKeyword:
    case SyntaxKind.NumberKeyword:
    case SyntaxKind.StringKeyword:
    case SyntaxKind.SymbolKeyword:
    case SyntaxKind.UndefinedKeyword:
    case SyntaxKind.VoidKeyword: {
      return { kind: "Primitive" };
    }
    default: {
      return makeType();
    }
  }
};
