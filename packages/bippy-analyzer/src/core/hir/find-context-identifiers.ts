/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/FindContextIdentifiers.ts at b618bbb.

import type { Node, PostfixUnaryExpression, PrefixUnaryExpression } from "typescript/unstable/ast";
import { SyntaxKind, formatSyntaxKind } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import { CompilerError } from "../compiler-error.js";
import { getOrInsertDefault } from "../utils/utils.js";
import { getSourceLocation } from "./hir.js";
import {
  type FunctionNode,
  type IdentifierNode,
  type ScopeManager,
  isFunctionNode,
  isReferencedIdentifier,
} from "./scope.js";

interface IdentifierInfo {
  reassigned: boolean;
  reassignedByInnerFn: boolean;
  referencedByInnerFn: boolean;
}
const DEFAULT_IDENTIFIER_INFO: IdentifierInfo = {
  reassigned: false,
  reassignedByInnerFn: false,
  referencedByInnerFn: false,
};

interface FindContextIdentifierState {
  scopes: ScopeManager;
  currentFn: Array<FunctionNode>;
  identifiers: Map<IdentifierNode, IdentifierInfo>;
}

const isJsxTagName = (node: IdentifierNode): boolean => {
  let current: Node = node;
  while (t.isPropertyAccessExpression(current.parent) && current.parent.expression === current) {
    current = current.parent;
  }
  const parent = current.parent;
  return (
    (t.isJsxOpeningElement(parent) ||
      t.isJsxSelfClosingElement(parent) ||
      t.isJsxClosingElement(parent)) &&
    parent.tagName === current
  );
};

const isUpdateExpression = (node: Node): node is PrefixUnaryExpression | PostfixUnaryExpression =>
  (t.isPrefixUnaryExpression(node) &&
    (node.operator === SyntaxKind.PlusPlusToken || node.operator === SyntaxKind.MinusMinusToken)) ||
  t.isPostfixUnaryExpression(node);

export const findContextIdentifiers = (
  func: FunctionNode,
  scopes: ScopeManager,
): Set<IdentifierNode> => {
  const state: FindContextIdentifierState = {
    scopes,
    currentFn: [],
    identifiers: new Map(),
  };

  const visit = (node: Node): void => {
    if (t.isTypeNode(node)) {
      return;
    }
    if (isFunctionNode(node)) {
      state.currentFn.push(node);
      node.forEachChild(visit);
      state.currentFn.pop();
      return;
    }
    const currentFn = state.currentFn.at(-1) ?? null;
    if (t.isBinaryExpression(node) && t.isAssignmentOperator(node.operatorToken.kind)) {
      handleAssignment(currentFn, state, node.left);
    } else if (isUpdateExpression(node)) {
      const argument = unwrapParentheses(node.operand);
      if (
        t.isIdentifier(argument) ||
        t.isPropertyAccessExpression(argument) ||
        t.isElementAccessExpression(argument)
      ) {
        handleAssignment(currentFn, state, argument);
      }
    } else if (t.isIdentifier(node) && !isJsxTagName(node) && isReferencedIdentifier(node)) {
      handleIdentifier(currentFn, state, node);
    }
    node.forEachChild(visit);
  };
  func.forEachChild(visit);

  const result = new Set<IdentifierNode>();
  for (const [identifier, info] of state.identifiers.entries()) {
    if (info.reassignedByInnerFn) {
      result.add(identifier);
    } else if (info.reassigned && info.referencedByInnerFn) {
      result.add(identifier);
    }
  }
  return result;
};

const unwrapParentheses = (node: Node): Node =>
  t.isParenthesizedExpression(node) ? unwrapParentheses(node.expression) : node;

const handleIdentifier = (
  currentFn: FunctionNode | null,
  state: FindContextIdentifierState,
  node: IdentifierNode,
): void => {
  const binding = state.scopes.resolveIdentifier(node);
  if (binding === null) {
    return;
  }
  const identifier = getOrInsertDefault(state.identifiers, binding.identifier, {
    ...DEFAULT_IDENTIFIER_INFO,
  });

  if (currentFn !== null) {
    const bindingAboveLambdaScope = state.scopes.getBinding(
      state.scopes.getScope(currentFn).parent,
      node.text,
    );

    if (binding === bindingAboveLambdaScope) {
      identifier.referencedByInnerFn = true;
    }
  }
};

const handleAssignment = (
  currentFn: FunctionNode | null,
  state: FindContextIdentifierState,
  lvalNode: Node,
): void => {
  /*
   * Find all reassignments to identifiers declared outside of currentFn
   * This closely follows destructuring assignment assumptions and logic in BuildHIR
   */
  const node = unwrapParentheses(lvalNode);
  if (t.isIdentifier(node)) {
    const binding = state.scopes.resolveIdentifier(node);
    if (binding === null) {
      return;
    }
    const identifierState = getOrInsertDefault(state.identifiers, binding.identifier, {
      ...DEFAULT_IDENTIFIER_INFO,
    });
    identifierState.reassigned = true;

    if (currentFn !== null) {
      const bindingAboveLambdaScope = state.scopes.getBinding(
        state.scopes.getScope(currentFn).parent,
        node.text,
      );

      if (binding === bindingAboveLambdaScope) {
        identifierState.reassignedByInnerFn = true;
      }
    }
    return;
  }
  if (t.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (!t.isOmittedExpression(element)) {
        handleAssignment(currentFn, state, element);
      }
    }
    return;
  }
  if (t.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (t.isPropertyAssignment(property)) {
        handleAssignment(currentFn, state, property.initializer);
      } else if (t.isShorthandPropertyAssignment(property)) {
        handleAssignment(currentFn, state, property.name);
      } else {
        CompilerError.invariant(t.isSpreadAssignment(property), {
          reason: `[FindContextIdentifiers] Invalid assumptions for babel types.`,
          loc: getSourceLocation(property),
        });
        handleAssignment(currentFn, state, property.expression);
      }
    }
    return;
  }
  if (t.isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.EqualsToken) {
    handleAssignment(currentFn, state, node.left);
    return;
  }
  if (t.isSpreadElement(node)) {
    handleAssignment(currentFn, state, node.expression);
    return;
  }
  if (t.isPropertyAccessExpression(node) || t.isElementAccessExpression(node)) {
    // Interior mutability (not a reassign)
    return;
  }
  CompilerError.throwTodo({
    reason: `[FindContextIdentifiers] Cannot handle Object destructuring assignment target ${formatSyntaxKind(node.kind)}`,
    description: null,
    loc: getSourceLocation(node),
    suggestions: null,
  });
};
