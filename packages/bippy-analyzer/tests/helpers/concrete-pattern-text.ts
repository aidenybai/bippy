import type { PatternNode } from "../../src/harness/static-pattern.js";

export const getConcretePatternText = (nodes: PatternNode[]): string[] =>
  nodes.flatMap((node) => {
    if (node.kind === "fiber") return getConcretePatternText(node.children);
    if (node.kind === "text" && node.text !== null) return [node.text];
    throw new Error(`Expected a concrete tree, received ${node.kind}`);
  });
