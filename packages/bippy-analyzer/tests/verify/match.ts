import type { RenderNode } from "../../src/symbolic-tree/model.ts";
import type { Shape } from "./types.ts";

export type ExpectedShape =
  | { kind: "element"; tag: string; children: ExpectedShape[] }
  | { kind: "component"; name: string; isKnown: boolean }
  | { kind: "text"; text: string }
  | { kind: "hole" }
  | { kind: "repeat"; item: ExpectedShape[] }
  | { kind: "choice"; options: ExpectedShape[][] };

const TRANSPARENT_TAG_PATTERN = /(^|\.)(Fragment|Provider|Consumer|Suspense|StrictMode|Profiler)$/;
const WRAPPER_NAME_PATTERN = /^(?:Memo|ForwardRef|Lazy)\((.*)\)$/;
const MAX_MATCH_STEPS = 200_000;
const GENERIC_COMPONENT_NAMES = new Set(["Anonymous", "ForwardRef", "Memo", "Lazy"]);

const normalizeText = (text: string): string => text.replace(/\s+/g, " ").trim();

const normalizeName = (name: string): string => {
  const unwrapped = WRAPPER_NAME_PATTERN.exec(name)?.[1] ?? name;
  return unwrapped === name ? (name.split(".").pop() ?? name) : normalizeName(unwrapped);
};

export const toExpected = (
  node: RenderNode,
  knownComponents: Map<string, string>,
): ExpectedShape[] => {
  const recurse = (child: RenderNode): ExpectedShape[] => toExpected(child, knownComponents);
  switch (node.kind) {
    case "element":
      if (node.tag === "" || TRANSPARENT_TAG_PATTERN.test(node.tag))
        return node.children.flatMap(recurse);
      if (node.isComponent) {
        const runtimeName = knownComponents.get(node.tag);
        return [
          {
            kind: "component",
            name: normalizeName(runtimeName ?? node.tag),
            isKnown: runtimeName !== undefined,
          },
        ];
      }
      return [{ kind: "element", tag: node.tag, children: node.children.flatMap(recurse) }];
    case "text": {
      const text = normalizeText(node.text);
      return text ? [{ kind: "text", text }] : [];
    }
    case "value":
    case "unknown":
      return [{ kind: "hole" }];
    case "list":
      return [{ kind: "repeat", item: recurse(node.item) }];
    case "branch":
      return [{ kind: "choice", options: [recurse(node.whenTrue), recurse(node.whenFalse)] }];
    case "empty":
      return [];
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
    if (actual.kind !== "component") return false;
    return (
      !expected.isKnown || actual.name === expected.name || GENERIC_COMPONENT_NAMES.has(actual.name)
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

const flattenTags = (shapes: Array<Shape | ExpectedShape>): string[] =>
  shapes.flatMap((shape) => {
    if (shape.kind === "element") return [shape.tag, ...flattenTags(shape.children)];
    if (shape.kind === "component") return [`<${shape.name}>`];
    if (shape.kind === "text") return [`"${shape.text}"`];
    if (shape.kind === "repeat") return flattenTags(shape.item);
    if (shape.kind === "choice") return shape.options.flatMap(flattenTags);
    return [];
  });

export const findClosest = (candidates: ExpectedShape[][], actual: Shape[]): number => {
  const actualTags = new Set(flattenTags(actual));
  let bestIndex = 0;
  let bestScore = -1;
  candidates.forEach((candidate, index) => {
    const candidateTags = new Set(flattenTags(candidate));
    const shared = [...candidateTags].filter((tag) => actualTags.has(tag)).length;
    const score = shared / Math.max(1, new Set([...candidateTags, ...actualTags]).size);
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
