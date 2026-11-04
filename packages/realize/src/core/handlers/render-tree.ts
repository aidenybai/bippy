import type { JsxExpressionValue, SymbolicValue } from "../types";
import { forEachPropNode } from "../render/for-each-jsx-element";
import { getRenderChildren } from "../render/get-render-children";
import { getTestExpression } from "../values/get-test-expression";
import { getValueKey } from "../values/get-value-key";
import { negate } from "../values/negate";

export interface RenderTree {
  elements: JsxExpressionValue[];
  parents: number[];
  guards: SymbolicValue[][];
  indexes: Map<JsxExpressionValue, number>;
}

const NO_PARENT = -1;

export const intersectGuards = (left: SymbolicValue[], right: SymbolicValue[]): SymbolicValue[] => {
  const rightKeys = new Set(right.map(getValueKey));
  return left.filter((guard) => rightKeys.has(getValueKey(guard)));
};

export const getRenderTree = (render: SymbolicValue): RenderTree => {
  const tree: RenderTree = { elements: [], parents: [], guards: [], indexes: new Map() };
  const guardsByNode = new Map<SymbolicValue, SymbolicValue[]>();
  const addElement = (element: JsxExpressionValue, parent: number): number => {
    const index = tree.elements.push(element) - 1;
    tree.parents.push(parent);
    tree.indexes.set(element, index);
    return index;
  };
  const walk = (node: SymbolicValue, parent: number, guards: SymbolicValue[]): void => {
    const previousGuards = guardsByNode.get(node);
    const nodeGuards = previousGuards ? intersectGuards(previousGuards, guards) : guards;
    if (previousGuards && nodeGuards.length === previousGuards.length) return;
    guardsByNode.set(node, nodeGuards);
    if (node.kind === "Conditional") {
      const test = getTestExpression(node);
      walk(node.consequent, parent, [...nodeGuards, test]);
      walk(node.alternate, parent, [...nodeGuards, negate(test)]);
      return;
    }
    if (node.kind !== "JsxExpression") {
      for (const child of getRenderChildren(node)) walk(child, parent, nodeGuards);
      return;
    }
    const index = tree.indexes.get(node) ?? addElement(node, parent);
    tree.guards[index] = nodeGuards;
    forEachPropNode(node, (propNode) => walk(propNode, NO_PARENT, nodeGuards));
    for (const child of node.children) walk(child, index, nodeGuards);
  };
  walk(render, NO_PARENT, []);
  return tree;
};

export const getAncestors = (
  tree: RenderTree,
  element: JsxExpressionValue,
): JsxExpressionValue[] => {
  const ancestors: JsxExpressionValue[] = [];
  const index = tree.indexes.get(element);
  if (index === undefined) return ancestors;
  for (let parent = tree.parents[index] ?? NO_PARENT; parent !== NO_PARENT;) {
    const ancestor = tree.elements[parent];
    if (ancestor) ancestors.push(ancestor);
    parent = tree.parents[parent] ?? NO_PARENT;
  }
  return ancestors.reverse();
};

export const getDescendants = (
  tree: RenderTree,
  element: JsxExpressionValue,
): JsxExpressionValue[] => {
  const index = tree.indexes.get(element);
  if (index === undefined) return [];
  const isInside = tree.elements.map((_, candidate) => candidate === index);
  const descendants: JsxExpressionValue[] = [];
  for (let candidate = index + 1; candidate < tree.elements.length; candidate++) {
    const parent = tree.parents[candidate] ?? NO_PARENT;
    if (parent === NO_PARENT || !isInside[parent]) continue;
    isInside[candidate] = true;
    const descendant = tree.elements[candidate];
    if (descendant) descendants.push(descendant);
  }
  return descendants;
};
