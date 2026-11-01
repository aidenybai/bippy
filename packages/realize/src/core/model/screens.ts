import type { ConditionalValue, SymbolicValue } from "../types";
import { formatNegated, formatSymbolicValue } from "../values/format";
import { getTestExpression } from "../values/get-test-expression";
import { isNullish } from "../values/is-nullish";
import { getMemoizedRender } from "../render/get-memoized-render";
import { TRUE, and, not } from "./conditions";
import type { LaneTable } from "./lanes";
import type { Arm, Condition, Screen } from "./types";

const MAX_SCREENS = 64;

interface Variant {
  condition: Condition;
  conditions: string[];
  parts: string[];
}

const SINGLE: Variant[] = [{ condition: TRUE, conditions: [], parts: [] }];

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
    right.map((rightVariant) => ({
      condition: and([leftVariant.condition, rightVariant.condition]),
      conditions: [...leftVariant.conditions, ...rightVariant.conditions],
      parts: [...leftVariant.parts, ...rightVariant.parts],
    })),
  );

export const collectScreens = (
  table: LaneTable,
  render: SymbolicValue,
  file: string,
): { screens: Screen[]; arms: Arm[] } => {
  const arms: Arm[] = [];
  const visited = new WeakSet<SymbolicValue>();

  const recordArms = (node: ConditionalValue, test: Condition, path: Condition): void => {
    const text = formatSymbolicValue(getTestExpression(node));
    const loc = node.branch.loc;
    const armFile = node.branch.file || file;
    arms.push({
      test: text,
      isTrueSide: true,
      isReachable: null,
      condition: and([path, test]),
      loc,
      file: armFile,
    });
    arms.push({
      test: text,
      isTrueSide: false,
      isReachable: null,
      condition: and([path, not(test)]),
      loc,
      file: armFile,
    });
  };

  const withArm = (
    arm: SymbolicValue,
    test: Condition,
    text: string,
    variants: Variant[],
  ): Variant[] => {
    const part = describeRoot(arm);
    return variants.map((variant) => ({
      condition: and([test, variant.condition]),
      conditions: [text, ...variant.conditions],
      parts: part ? [part, ...variant.parts] : variant.parts,
    }));
  };

  const collectChildren = (
    children: SymbolicValue[],
    path: Condition,
    isSplitting: boolean,
  ): Variant[] =>
    children.reduce<Variant[]>((variants, child) => {
      const childVariants = walk(child, path, isSplitting);
      return variants.length * childVariants.length > MAX_SCREENS
        ? variants
        : multiply(variants, childVariants);
    }, SINGLE);

  const walk = (node: SymbolicValue, path: Condition, isSplitting: boolean): Variant[] => {
    if (visited.has(node)) return SINGLE;
    visited.add(node);
    switch (node.kind) {
      case "Conditional": {
        const test = table.compile(getTestExpression(node));
        recordArms(node, test, path);
        const consequent = walk(node.consequent, and([path, test]), isSplitting);
        const alternate = walk(node.alternate, and([path, not(test)]), isSplitting);
        if (!isSplitting) return SINGLE;
        const testValue = getTestExpression(node);
        return [
          ...withArm(node.consequent, test, formatSymbolicValue(testValue), consequent),
          ...withArm(node.alternate, not(test), formatNegated(testValue), alternate),
        ];
      }
      case "JsxExpression":
      case "JsxFragment":
        return collectChildren(node.children, path, isSplitting);
      case "ArrayExpression":
        return collectChildren([...node.elements, ...node.spreads], path, isSplitting);
      case "ArrayMap":
        walk(node.item, path, false);
        return SINGLE;
      case "Binding": {
        const memoized = getMemoizedRender(node);
        return memoized ? walk(memoized, path, isSplitting) : SINGLE;
      }
      default:
        return SINGLE;
    }
  };

  const rootPart = describeRoot(render);
  const variants = walk(render, TRUE, true).slice(0, MAX_SCREENS);
  const usedLabels = new Set<string>();
  const screens = variants.map((variant, index): Screen => {
    const parts = rootPart && render.kind !== "Conditional" ? [rootPart, ...variant.parts] : variant.parts;
    const baseLabel = parts.join(" > ") || "nothing";
    let label = baseLabel;
    for (let suffix = 2; usedLabels.has(label); suffix++) label = `${baseLabel} (${suffix})`;
    usedLabels.add(label);
    return {
      name: `S${index + 1}`,
      label,
      condition: variant.condition,
      conditions: variant.conditions,
    };
  });
  return { screens, arms };
};
