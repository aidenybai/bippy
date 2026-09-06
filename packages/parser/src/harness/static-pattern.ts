import type { SourceLocation, StaticFiber } from "../types.js";
import { getWorkTagName } from "../work-tags.js";
import { collectChildren } from "../fiber/serialize.js";
import type { SnapshotWorkTag } from "./snapshot.js";

// A pattern is the static fiber tree flattened into something the matcher can
// consume: concrete nodes, text, alternatives, repeats, and wildcards.

export interface PatternNodeBase {
  location: SourceLocation | null;
}

export interface PatternFiber extends PatternNodeBase {
  kind: "fiber";
  tag: SnapshotWorkTag;
  name: string | null;
  key: string | null;
  children: PatternNode[];
}

export interface PatternText extends PatternNodeBase {
  kind: "text";
  text: string | null;
}

export interface PatternBranch extends PatternNodeBase {
  kind: "branch";
  reason: string;
  preferredIndex: number | null;
  alternatives: PatternNode[][];
}

export interface PatternRepeat extends PatternNodeBase {
  kind: "repeat";
  children: PatternNode[];
}

export interface PatternOpaque extends PatternNodeBase {
  kind: "opaque";
  name: string;
  key: string | null;
  reason: string;
  /** Children the application passed to the external component; matched somewhere inside its runtime subtree. */
  passedChildren: PatternNode[];
}

export interface PatternWildcard extends PatternNodeBase {
  kind: "wildcard";
  reason: string;
}

export type PatternNode =
  | PatternFiber
  | PatternText
  | PatternBranch
  | PatternRepeat
  | PatternOpaque
  | PatternWildcard;

export const toPattern = (fiber: StaticFiber): PatternNode => {
  switch (fiber.kind) {
    case "fiber":
      return {
        kind: "fiber",
        tag: getWorkTagName(fiber.tag),
        name: fiber.displayName,
        key: fiber.key,
        children: collectChildren(fiber.child).map(toPattern),
        location: fiber.location,
      };
    case "text":
      return { kind: "text", text: fiber.text, location: fiber.location };
    case "branch":
      return {
        kind: "branch",
        reason: fiber.reason,
        preferredIndex: fiber.preferredIndex,
        alternatives: fiber.alternatives.map((alternative) =>
          collectChildren(alternative).map(toPattern),
        ),
        location: fiber.location,
      };
    case "repeat":
      return {
        kind: "repeat",
        children: collectChildren(fiber.child).map(toPattern),
        location: fiber.location,
      };
    case "opaque":
      return {
        kind: "opaque",
        name: fiber.displayName,
        key: fiber.key,
        reason: fiber.reason,
        passedChildren: collectChildren(fiber.passedChildren).map(toPattern),
        location: fiber.location,
      };
    case "unknown":
      return { kind: "wildcard", reason: fiber.reason, location: fiber.location };
  }
};

const flattenPatternNode = (node: PatternNode, transparent: ReadonlySet<string>): PatternNode[] => {
  switch (node.kind) {
    case "fiber": {
      const children = flattenPatternFibers(node.children, transparent);
      if (transparent.has(node.name ?? node.tag)) return children;
      return [{ ...node, children }];
    }
    case "branch":
      return [
        {
          ...node,
          alternatives: node.alternatives.map((alternative) =>
            flattenPatternFibers(alternative, transparent),
          ),
        },
      ];
    case "repeat":
      return [{ ...node, children: flattenPatternFibers(node.children, transparent) }];
    case "opaque":
      return [{ ...node, passedChildren: flattenPatternFibers(node.passedChildren, transparent) }];
    case "text":
    case "wildcard":
      return [node];
  }
};

/** Splices out fibers named in `transparent` (anonymous ones by tag), promoting their children; used for framework wrappers synthesized on the static side. */
export const flattenPatternFibers = (
  nodes: PatternNode[],
  transparent: ReadonlySet<string>,
): PatternNode[] => {
  if (transparent.size === 0) return nodes;
  const result: PatternNode[] = [];
  for (const node of nodes) result.push(...flattenPatternNode(node, transparent));
  return result;
};

export const countPatternFibers = (node: PatternNode): number => {
  switch (node.kind) {
    case "fiber":
      return 1 + node.children.reduce((sum, child) => sum + countPatternFibers(child), 0);
    case "text":
      return 1;
    case "opaque":
      return 1 + node.passedChildren.reduce((sum, child) => sum + countPatternFibers(child), 0);
    case "branch":
      return Math.max(
        0,
        ...node.alternatives.map((alternative) =>
          alternative.reduce((sum, child) => sum + countPatternFibers(child), 0),
        ),
      );
    case "repeat":
      return node.children.reduce((sum, child) => sum + countPatternFibers(child), 0);
    case "wildcard":
      return 0;
  }
};
