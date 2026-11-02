import type { ConditionalValue, SymbolicValue } from "../types";
import { formatNegated, formatSymbolicValue } from "../values/format";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { isNullish } from "../values/is-nullish";
import { getMemoizedRender } from "../render/get-memoized-render";
import { TRUE, and, not, or } from "./predicates";
import type { VariableTable } from "./variables";
import type { Branch, Predicate, View } from "./types";

const MAX_VIEWS = 64;

interface TestContext {
  node: ConditionalValue;
  pathCondition: Predicate;
}

export const NO_VIEW = "nothing";

interface RenderPath {
  predicate: Predicate;
  conditions: string[];
  parts: string[];
}

const SINGLE: RenderPath[] = [{ predicate: TRUE, conditions: [], parts: [] }];

const getDirectText = (children: SymbolicValue[]): string =>
  children
    .map((child) =>
      child.kind === "JSXText" || (child.kind === "Primitive" && typeof child.value === "string")
        ? String(child.value).trim()
        : "",
    )
    .filter(Boolean)
    .join(" ");

const describeRoot = (value: SymbolicValue): string | null => {
  switch (value.kind) {
    case "JsxExpression": {
      const text = getDirectText(value.children);
      return text ? `${value.tag.name} ${JSON.stringify(text)}` : value.tag.name;
    }
    case "JsxFragment": {
      const [first] = value.children;
      return first ? describeRoot(first) : null;
    }
    case "Primitive":
      return isNullish(value.value) || typeof value.value === "boolean"
        ? null
        : JSON.stringify(value.value);
    case "JSXText":
      return JSON.stringify(value.value.trim());
    case "ArrayMap":
      return "list";
    case "Binding": {
      const memoized = getMemoizedRender(value);
      return memoized ? describeRoot(memoized) : null;
    }
    default:
      return null;
  }
};

const multiply = (left: RenderPath[], right: RenderPath[]): RenderPath[] =>
  left.flatMap((leftPath) =>
    right.flatMap((rightPath) => {
      const predicate = and([leftPath.predicate, rightPath.predicate]);
      if (predicate.kind === "False") return [];
      return [
        {
          predicate,
          conditions: [...leftPath.conditions, ...rightPath.conditions],
          parts: [...leftPath.parts, ...rightPath.parts],
        },
      ];
    }),
  );

export const collectViews = (
  table: VariableTable,
  render: SymbolicValue,
  file: string,
): { views: View[]; branches: Branch[] } => {
  const branchesByNode = new Map<ConditionalValue, Branch>();
  const testContexts: TestContext[] = [];
  const visited = new WeakSet<SymbolicValue>();

  const recordBranch = (
    node: ConditionalValue,
    test: Predicate,
    pathCondition: Predicate,
  ): void => {
    const consequent = and([pathCondition, test]);
    const alternate = and([pathCondition, not(test)]);
    const existing = branchesByNode.get(node);
    branchesByNode.set(node, {
      label: formatSymbolicValue(getTestExpression(node)),
      loc: node.branch.loc,
      file: node.branch.file || file,
      consequent: {
        predicate: existing ? or([existing.consequent.predicate, consequent]) : consequent,
        isReachable: null,
      },
      alternate: {
        predicate: existing ? or([existing.alternate.predicate, alternate]) : alternate,
        isReachable: null,
      },
    });
  };

  const withEdge = (
    successor: SymbolicValue,
    test: Predicate,
    text: string,
    renderPaths: RenderPath[],
  ): RenderPath[] => {
    const part = describeRoot(successor);
    return renderPaths.flatMap((renderPath) => {
      const predicate = and([test, renderPath.predicate]);
      if (predicate.kind === "False") return [];
      return [
        {
          predicate,
          conditions: [text, ...renderPath.conditions],
          parts: part ? [part, ...renderPath.parts] : renderPath.parts,
        },
      ];
    });
  };

  const collectChildren = (
    children: SymbolicValue[],
    pathCondition: Predicate,
    isSplitting: boolean,
  ): RenderPath[] =>
    children.reduce<RenderPath[]>((renderPaths, child) => {
      const childPaths = walk(child, pathCondition, isSplitting);
      return renderPaths.length * childPaths.length > MAX_VIEWS
        ? renderPaths
        : multiply(renderPaths, childPaths);
    }, SINGLE);

  const walk = (
    node: SymbolicValue,
    pathCondition: Predicate,
    isSplitting: boolean,
  ): RenderPath[] => {
    if (visited.has(node)) return SINGLE;
    visited.add(node);
    switch (node.kind) {
      case "Conditional": {
        const test = table.compile(getTestExpression(node));
        recordBranch(node, test, pathCondition);
        forEachSymbolicValue(getTestExpression(node), (inner) => {
          if (inner.kind === "Conditional" && inner !== node)
            testContexts.push({ node: inner, pathCondition });
        });
        const consequent = walk(node.consequent, and([pathCondition, test]), isSplitting);
        const alternate = walk(node.alternate, and([pathCondition, not(test)]), isSplitting);
        if (!isSplitting) return SINGLE;
        const testValue = getTestExpression(node);
        return [
          ...withEdge(node.consequent, test, formatSymbolicValue(testValue), consequent),
          ...withEdge(node.alternate, not(test), formatNegated(testValue), alternate),
        ];
      }
      case "JsxExpression":
      case "JsxFragment":
        return collectChildren(node.children, pathCondition, isSplitting);
      case "ArrayExpression":
        return collectChildren([...node.elements, ...node.spreads], pathCondition, isSplitting);
      case "ArrayMap":
        walk(node.item, pathCondition, false);
        return SINGLE;
      case "Binding": {
        const memoized = getMemoizedRender(node);
        return memoized ? walk(memoized, pathCondition, isSplitting) : SINGLE;
      }
      default:
        return SINGLE;
    }
  };

  const rootPart = describeRoot(render);
  const renderPaths = walk(render, TRUE, true).slice(0, MAX_VIEWS);
  const usedLabels = new Set<string>();
  const views = renderPaths.map((renderPath, index): View => {
    const parts =
      rootPart && render.kind !== "Conditional"
        ? [rootPart, ...renderPath.parts]
        : renderPath.parts;
    const baseLabel = parts.join(" > ") || NO_VIEW;
    let label = baseLabel;
    for (let suffix = 2; usedLabels.has(label); suffix++) label = `${baseLabel} (${suffix})`;
    usedLabels.add(label);
    return {
      name: `S${index + 1}`,
      label,
      predicate: renderPath.predicate,
      conditions: renderPath.conditions,
    };
  });
  for (const context of testContexts)
    if (branchesByNode.has(context.node))
      recordBranch(
        context.node,
        table.compile(getTestExpression(context.node)),
        context.pathCondition,
      );
  return { views, branches: [...branchesByNode.values()] };
};
