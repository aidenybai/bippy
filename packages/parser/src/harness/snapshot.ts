// Shared, JSON-serializable tree shape produced by both the static renderer and
// runtime capture. Keeping this file free of Node imports lets the browser
// injection bundle reuse it.

import type { WorkTagName } from "../work-tags.js";

export type SnapshotWorkTag =
  | WorkTagName
  | "CacheComponent"
  | "TracingMarkerComponent"
  | "LegacyHiddenComponent"
  | "ScopeComponent"
  | "DehydratedSuspenseComponent"
  | "IncompleteClassComponent"
  | "IncompleteFunctionComponent"
  | "Unknown";

export type SnapshotPropValue = string | number | boolean | null;

export interface RuntimeFiberSnapshot {
  tag: SnapshotWorkTag;
  name: string | null;
  key: string | null;
  text: string | null;
  props: Record<string, SnapshotPropValue>;
  children: RuntimeFiberSnapshot[];
}

export interface RuntimeSnapshot {
  reactVersion: string | null;
  rendererName: string | null;
  buildType: "development" | "production" | null;
  roots: RuntimeFiberSnapshot[];
  capturedAt: string;
}

export const countSnapshotFibers = (fiber: RuntimeFiberSnapshot): number => {
  let count = 1;
  for (const child of fiber.children) count += countSnapshotFibers(child);
  return count;
};

export const findSnapshotFiber = (
  fiber: RuntimeFiberSnapshot,
  predicate: (candidate: RuntimeFiberSnapshot) => boolean,
): RuntimeFiberSnapshot | null => {
  if (predicate(fiber)) return fiber;
  for (const child of fiber.children) {
    const match = findSnapshotFiber(child, predicate);
    if (match) return match;
  }
  return null;
};

export const formatRuntimeSnapshot = (fiber: RuntimeFiberSnapshot, depth = 0): string => {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  if (fiber.tag === "HostText") {
    lines.push(`${indent}${JSON.stringify(fiber.text ?? "")}`);
  } else {
    const key = fiber.key === null ? "" : ` key=${JSON.stringify(fiber.key)}`;
    const name = fiber.name ?? fiber.tag;
    lines.push(`${indent}<${name}>${key}${fiber.name === null ? "" : ` [${fiber.tag}]`}`);
  }
  for (const child of fiber.children) lines.push(formatRuntimeSnapshot(child, depth + 1));
  return lines.join("\n");
};
