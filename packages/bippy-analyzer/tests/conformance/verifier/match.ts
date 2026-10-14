import { diffArrays } from "diff";
import type { SymbolicValue } from "../../../src/core/types";
import { isRenderingNothing } from "../../../src/core/utils/checks";
import type { Shape } from "./types";

export type ExpectedShape =
  | { kind: "element"; tag: string; children: ExpectedShape[] }
  | { kind: "component"; name: string; isKnown: boolean }
  | { kind: "text"; text: string }
  | { kind: "hole" }
  | { kind: "repeat"; item: ExpectedShape[] }
  | { kind: "choice"; options: ExpectedShape[][] };

const TRANSPARENT_TAG_PATTERN = /(^|\.)(Fragment|Suspense|StrictMode|Profiler)$/;
const CONTEXT_TAG_PATTERN = /(^|\.)(Provider|Consumer)$/;
const WRAPPER_NAME_PATTERN = /^(?:Memo|ForwardRef|Lazy)\((.*)\)$/;
const MAX_MATCH_STEPS = 200_000;
const GENERIC_COMPONENT_NAMES = new Set(["Anonymous", "ForwardRef", "Memo", "Lazy"]);
const RENAMED_SUFFIX_PATTERN = /\d+$/;

export const normalizeText = (text: string): string => text.replace(/\s+/g, " ").trim();

const normalizeName = (name: string): string => {
  const unwrapped = WRAPPER_NAME_PATTERN.exec(name)?.[1] ?? name;
  return unwrapped === name ? (name.split(".").pop() ?? name) : normalizeName(unwrapped);
};

export const toExpected = (
  value: SymbolicValue,
  knownComponents: Map<string, string>,
): ExpectedShape[] => {
  const recurse = (child: SymbolicValue): ExpectedShape[] => toExpected(child, knownComponents);
  switch (value.kind) {
    case "JsxExpression": {
      const { tag } = value;
      if (tag.kind === "DynamicTag") return [{ kind: "hole" }];
      if (TRANSPARENT_TAG_PATTERN.test(tag.name)) return value.children.flatMap(recurse);
      if (CONTEXT_TAG_PATTERN.test(tag.name))
        return [
          {
            kind: "choice",
            options: [
              value.children.flatMap(recurse),
              [{ kind: "component", name: normalizeName(tag.name), isKnown: false }],
            ],
          },
        ];
      if (tag.kind === "Component" && tag.isContext) return value.children.flatMap(recurse);
      if (tag.kind === "Component") {
        const runtimeName = tag.declaration ? knownComponents.get(tag.declaration) : undefined;
        return [
          {
            kind: "component",
            name: normalizeName(runtimeName ?? tag.name),
            isKnown: runtimeName !== undefined,
          },
        ];
      }
      const hasSpreadChildren =
        value.children.length === 0 &&
        value.props.some((prop) => prop.kind === "JsxSpreadAttribute");
      return [
        {
          kind: "element",
          tag: tag.name,
          children: hasSpreadChildren ? [{ kind: "hole" }] : value.children.flatMap(recurse),
        },
      ];
    }
    case "JsxFragment":
      return value.children.flatMap(recurse);
    case "JSXText": {
      const text = normalizeText(value.value);
      return text ? [{ kind: "text", text }] : [];
    }
    case "ArrayMap":
      return [{ kind: "repeat", item: recurse(value.item) }];
    case "Conditional":
      return [{ kind: "choice", options: [recurse(value.consequent), recurse(value.alternate)] }];
    case "Primitive": {
      if (isRenderingNothing(value)) return [];
      const text = normalizeText(String(value.value));
      return text ? [{ kind: "text", text }] : [];
    }
    default:
      return [{ kind: "hole" }];
  }
};

export const normalizeShapes = (shapes: Shape[]): Shape[] =>
  shapes.flatMap((shape): Shape[] => {
    if (shape.kind === "text") {
      const text = normalizeText(shape.text);
      return text ? [{ kind: "text", text }] : [];
    }
    if (shape.kind === "component") return [{ kind: "component", name: normalizeName(shape.name) }];
    return [{ kind: "element", tag: shape.tag, children: normalizeShapes(shape.children) }];
  });

interface MatchBudget {
  steps: number;
}

const matchOne = (expected: ExpectedShape, actual: Shape, budget: MatchBudget): boolean => {
  if (expected.kind === "text") return actual.kind === "text" && actual.text === expected.text;
  if (expected.kind === "component") {
    if (actual.kind === "element")
      return !expected.isKnown && actual.tag.toLowerCase() === expected.name.toLowerCase();
    if (actual.kind !== "component") return false;
    return (
      !expected.isKnown ||
      actual.name === expected.name ||
      actual.name.replace(RENAMED_SUFFIX_PATTERN, "") === expected.name ||
      GENERIC_COMPONENT_NAMES.has(actual.name)
    );
  }
  if (expected.kind === "element") {
    return (
      actual.kind === "element" &&
      actual.tag === expected.tag &&
      matchSequence(expected.children, actual.children, budget)
    );
  }
  return false;
};

const matchSequence = (
  expected: ExpectedShape[],
  actual: Shape[],
  budget: MatchBudget,
): boolean => {
  budget.steps++;
  if (budget.steps > MAX_MATCH_STEPS) return false;
  const [first, ...restExpected] = expected;
  if (!first) return actual.length === 0;
  if (first.kind === "hole") {
    for (let taken = 0; taken <= actual.length; taken++) {
      if (matchSequence(restExpected, actual.slice(taken), budget)) return true;
    }
    return false;
  }
  if (first.kind === "choice") {
    return first.options.some((option) =>
      matchSequence([...option, ...restExpected], actual, budget),
    );
  }
  if (first.kind === "repeat") {
    if (matchSequence(restExpected, actual, budget)) return true;
    if (first.item.length === 0) return false;
    for (let taken = 1; taken <= actual.length; taken++) {
      if (
        matchSequence(first.item, actual.slice(0, taken), budget) &&
        matchSequence([first, ...restExpected], actual.slice(taken), budget)
      ) {
        return true;
      }
    }
    return false;
  }
  const [head, ...restActual] = actual;
  return (
    head !== undefined &&
    matchOne(first, head, budget) &&
    matchSequence(restExpected, restActual, budget)
  );
};

export const matchesExpected = (expected: ExpectedShape[], actual: Shape[]): boolean =>
  matchSequence(expected, actual, { steps: 0 });

const HOLE_TOKEN = "…";
const MAX_EXPLAINED_TOKENS = 4;

const getActualTokens = (shapes: Shape[]): string[] =>
  shapes.flatMap((shape) => {
    if (shape.kind === "element") return [`<${shape.tag}>`, ...getActualTokens(shape.children)];
    if (shape.kind === "component") return [`<${shape.name}>`];
    return [JSON.stringify(shape.text)];
  });

const getExpectedTokens = (shapes: ExpectedShape[], actualTokens: Set<string> | null): string[] =>
  shapes.flatMap((shape): string[] => {
    switch (shape.kind) {
      case "element":
        return [`<${shape.tag}>`, ...getExpectedTokens(shape.children, actualTokens)];
      case "component":
        return [`<${shape.name}>`];
      case "text":
        return [JSON.stringify(shape.text)];
      case "hole":
        return [HOLE_TOKEN];
      case "repeat":
        return getExpectedTokens(shape.item, actualTokens);
      case "choice": {
        const options = shape.options.map((option) => getExpectedTokens(option, actualTokens));
        if (!actualTokens) return options.flat();
        const getOverlap = (tokens: string[]): number =>
          tokens.filter((token) => actualTokens.has(token)).length;
        return options.reduce(
          (best, option) => (getOverlap(option) > getOverlap(best) ? option : best),
          options[0] ?? [],
        );
      }
      default:
        return [];
    }
  });

export const findClosest = (candidates: ExpectedShape[][], actual: Shape[]): number => {
  const actualTokens = new Set(getActualTokens(actual));
  let bestIndex = 0;
  let bestScore = -1;
  candidates.forEach((candidate, index) => {
    const candidateTokens = new Set(
      getExpectedTokens(candidate, null).filter((token) => token !== HOLE_TOKEN),
    );
    const shared = [...candidateTokens].filter((token) => actualTokens.has(token)).length;
    const score = shared / Math.max(1, new Set([...candidateTokens, ...actualTokens]).size);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
};

export const formatShapes = (shapes: Shape[]): string =>
  shapes
    .map((shape) => {
      if (shape.kind === "text") return JSON.stringify(shape.text);
      if (shape.kind === "component") return `<${shape.name}>`;
      return shape.children.length > 0
        ? `<${shape.tag}>${formatShapes(shape.children)}</${shape.tag}>`
        : `<${shape.tag}>`;
    })
    .join(" ");

export const explainMismatch = (expected: ExpectedShape[], actual: Shape[]): string => {
  const actualTokens = getActualTokens(actual);
  const changes = diffArrays(getExpectedTokens(expected, new Set(actualTokens)), actualTokens, {
    comparator: (left, right) => left === right || left === HOLE_TOKEN,
  });
  const missing =
    changes
      .find((change) => change.removed && change.value.some((token) => token !== HOLE_TOKEN))
      ?.value.filter((token) => token !== HOLE_TOKEN) ?? [];
  const extra = changes.find((change) => change.added)?.value ?? [];
  const parts = [
    missing.length > 0 && `expected ${missing.slice(0, MAX_EXPLAINED_TOKENS).join(" ")}`,
    extra.length > 0 && `found ${extra.slice(0, MAX_EXPLAINED_TOKENS).join(" ")}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "same elements, arranged differently";
};
