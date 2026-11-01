import type { ConditionalValue, SymbolicValue } from "../types";
import { formatNegated, formatSymbolicValue } from "../values/format";
import { getTestExpression } from "../values/get-test-expression";
import { isNullish } from "../values/is-nullish";
import { getMemoizedRender } from "../render/get-memoized-render";
import { TRUE, and, not } from "./predicates";
import type { VariableTable } from "./variables";
import type { Branch, Predicate, View } from "./types";

const MAX_VIEWS = 64;

interface Variant {
  predicate: Predicate;
  path: string[];
  parts: string[];
}

const SINGLE: Variant[] = [{ predicate: TRUE, path: [], parts: [] }];

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

const multiply = (left: Variant[], right: Variant[]): Variant[] =>
  left.flatMap((leftVariant) =>
    right.flatMap((rightVariant) => {
      const predicate = and([leftVariant.predicate, rightVariant.predicate]);
      if (predicate.kind === "False") return [];
      return [
        {
          predicate,
          path: [...leftVariant.path, ...rightVariant.path],
          parts: [...leftVariant.parts, ...rightVariant.parts],
        },
      ];
    }),
  );

export const collectViews = (
  table: VariableTable,
  render: SymbolicValue,
  file: string,
): { views: View[]; branches: Branch[] } => {
  const branches: Branch[] = [];
  const visited = new WeakSet<SymbolicValue>();

  const recordBranch = (
    node: ConditionalValue,
    test: Predicate,
    pathCondition: Predicate,
  ): void => {
    branches.push({
      test: formatSymbolicValue(getTestExpression(node)),
      loc: node.branch.loc,
      file: node.branch.file || file,
      consequent: { predicate: and([pathCondition, test]), isReachable: null },
      alternate: { predicate: and([pathCondition, not(test)]), isReachable: null },
    });
  };

  const withEdge = (
    successor: SymbolicValue,
    test: Predicate,
    text: string,
    variants: Variant[],
  ): Variant[] => {
    const part = describeRoot(successor);
    return variants.flatMap((variant) => {
      const predicate = and([test, variant.predicate]);
      if (predicate.kind === "False") return [];
      return [
        {
          predicate,
          path: [text, ...variant.path],
          parts: part ? [part, ...variant.parts] : variant.parts,
        },
      ];
    });
  };

  const collectChildren = (
    children: SymbolicValue[],
    pathCondition: Predicate,
    isSplitting: boolean,
  ): Variant[] =>
    children.reduce<Variant[]>((variants, child) => {
      const childVariants = walk(child, pathCondition, isSplitting);
      return variants.length * childVariants.length > MAX_VIEWS
        ? variants
        : multiply(variants, childVariants);
    }, SINGLE);

  const walk = (node: SymbolicValue, pathCondition: Predicate, isSplitting: boolean): Variant[] => {
    if (visited.has(node)) return SINGLE;
    visited.add(node);
    switch (node.kind) {
      case "Conditional": {
        const test = table.compile(getTestExpression(node));
        recordBranch(node, test, pathCondition);
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
  const variants = walk(render, TRUE, true).slice(0, MAX_VIEWS);
  const usedLabels = new Set<string>();
  const views = variants.map((variant, index): View => {
    const parts =
      rootPart && render.kind !== "Conditional" ? [rootPart, ...variant.parts] : variant.parts;
    const baseLabel = parts.join(" > ") || "nothing";
    let label = baseLabel;
    for (let suffix = 2; usedLabels.has(label); suffix++) label = `${baseLabel} (${suffix})`;
    usedLabels.add(label);
    return {
      name: `S${index + 1}`,
      label,
      predicate: variant.predicate,
      path: variant.path,
    };
  });
  return { views, branches };
};
