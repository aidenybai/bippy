import { MARKER_NAMES, SUSPENSE_BRANCH_REASON } from "../materialize/markers.js";
import type { StaticRenderResult } from "../types.js";
import type { RuntimeFiberSnapshot, SnapshotPropValue, SnapshotWorkTag } from "./snapshot.js";

// A pattern is the materialized fiber tree as the matcher consumes it:
// concrete nodes, text, alternatives, repeats, opaque subtrees and wildcards.

export interface PatternFiber {
  kind: "fiber";
  tag: SnapshotWorkTag;
  name: string | null;
  key: string | null;
  children: PatternNode[];
}

export interface PatternText {
  kind: "text";
  text: string | null;
}

export interface PatternBranch {
  kind: "branch";
  reason: string;
  /** Where the source branched (`file:line:column`); null for branches the materializer introduces. */
  location: string | null;
  preferredIndex: number | null;
  alternatives: PatternNode[][];
}

export interface PatternRepeat {
  kind: "repeat";
  children: PatternNode[];
}

export interface PatternOpaque {
  kind: "opaque";
  name: string;
  /** Runtime names the external component may report; null when its export cannot be named statically (namespace member, default import, call result). */
  runtimeNames: string[] | null;
  key: string | null;
  reason: string;
  /** Children the application passed to the external component; matched somewhere inside its runtime subtree. */
  passedChildren: PatternNode[];
}

export interface PatternWildcard {
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

const readString = (props: Record<string, SnapshotPropValue>, key: string): string | null => {
  const value = props[key];
  return typeof value === "string" ? value : null;
};

const UNNAMEABLE_IMPORT = /[.*()`]|^default$/;

const getOpaqueRuntimeNames = (
  displayName: string | null,
  importedName: string | null,
): string[] | null => {
  if (importedName === null || UNNAMEABLE_IMPORT.test(importedName)) return null;
  return [...new Set([importedName, displayName].filter((name) => name !== null))];
};

const readNumber = (props: Record<string, SnapshotPropValue>, key: string): number | null => {
  const value = props[key];
  return typeof value === "number" ? value : null;
};

const toPatternNode = (fiber: RuntimeFiberSnapshot): PatternNode[] => {
  if (fiber.tag === "HostText") return [{ kind: "text", text: fiber.text }];
  switch (fiber.name) {
    case MARKER_NAMES.branch:
      return [
        {
          kind: "branch",
          reason: readString(fiber.props, "reason") ?? "",
          location: readString(fiber.props, "location"),
          preferredIndex: readNumber(fiber.props, "preferredIndex"),
          alternatives: fiber.children.map((alternative) =>
            snapshotToPattern(alternative.children),
          ),
        },
      ];
    case MARKER_NAMES.repeat:
      return [{ kind: "repeat", children: snapshotToPattern(fiber.children) }];
    case MARKER_NAMES.opaque:
      return [
        {
          kind: "opaque",
          name: readString(fiber.props, "displayName") ?? "",
          runtimeNames: getOpaqueRuntimeNames(
            readString(fiber.props, "displayName"),
            readString(fiber.props, "importedName"),
          ),
          key: fiber.key,
          reason: readString(fiber.props, "reason") ?? "",
          passedChildren: snapshotToPattern(fiber.children),
        },
      ];
    case MARKER_NAMES.unknown:
      return [{ kind: "wildcard", reason: readString(fiber.props, "reason") ?? "" }];
    case MARKER_NAMES.text:
      return [{ kind: "text", text: null }];
    case MARKER_NAMES.suspenseBoundary:
      return fiber.children.length > 1
        ? [
            {
              kind: "branch",
              reason: SUSPENSE_BRANCH_REASON,
              location: null,
              preferredIndex: 0,
              alternatives: fiber.children.map((boundary) => snapshotToPattern([boundary])),
            },
          ]
        : snapshotToPattern(fiber.children);
    case MARKER_NAMES.suspended:
      return [];
    default:
      return [
        {
          kind: "fiber",
          tag: fiber.tag,
          name: fiber.name,
          key: fiber.key,
          children: snapshotToPattern(fiber.children),
        },
      ];
  }
};

/**
 * Reads the materialized fiber tree back into a pattern: marker components
 * become branches, repeats, opaque subtrees and wildcards; everything else is
 * a concrete fiber. A tree without markers is a fully concrete pattern.
 */
export const snapshotToPattern = (fibers: RuntimeFiberSnapshot[]): PatternNode[] =>
  fibers.flatMap(toPatternNode);

export const getRenderPattern = (result: StaticRenderResult): PatternNode[] =>
  snapshotToPattern(result.snapshot.roots);

export const getRenderRootChildren = (result: StaticRenderResult): PatternNode[] =>
  snapshotToPattern(result.snapshot.roots.flatMap((root) => root.children));

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

const formatPatternNode = (node: PatternNode, depth: number): string[] => {
  const indent = "  ".repeat(depth);
  switch (node.kind) {
    case "fiber": {
      const key = node.key === null ? "" : ` key=${JSON.stringify(node.key)}`;
      return [
        `${indent}<${node.name ?? node.tag}>${key}`,
        ...node.children.flatMap((child) => formatPatternNode(child, depth + 1)),
      ];
    }
    case "text":
      return [`${indent}${node.text === null ? "#text(?)" : JSON.stringify(node.text)}`];
    case "branch":
      return [
        `${indent}?branch(${node.reason})${node.location === null ? "" : ` @ ${node.location}`}`,
        ...node.alternatives.flatMap((alternative, index) => [
          `${indent}  |${index}${node.preferredIndex === index ? " (preferred)" : ""}`,
          ...alternative.flatMap((child) => formatPatternNode(child, depth + 2)),
        ]),
      ];
    case "repeat":
      return [
        `${indent}*repeat`,
        ...node.children.flatMap((child) => formatPatternNode(child, depth + 1)),
      ];
    case "opaque": {
      const key = node.key === null ? "" : ` key=${JSON.stringify(node.key)}`;
      return [
        `${indent}<${node.name}>${key} (opaque: ${node.reason})`,
        ...node.passedChildren.flatMap((child) => formatPatternNode(child, depth + 1)),
      ];
    }
    case "wildcard":
      return [`${indent}?unknown(${node.reason})`];
  }
};

export const formatPattern = (nodes: PatternNode[]): string =>
  nodes.flatMap((node) => formatPatternNode(node, 0)).join("\n");
