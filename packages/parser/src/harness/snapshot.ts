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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPropValue = (value: unknown): value is SnapshotPropValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

const readNullableString = (value: unknown, path: string): string | null => {
  if (value === null || typeof value === "string") return value;
  throw new Error(`snapshot ${path}: expected string | null`);
};

const readFiber = (value: unknown, path: string): RuntimeFiberSnapshot => {
  if (!isRecord(value)) throw new Error(`snapshot ${path}: expected a fiber object`);
  if (typeof value.tag !== "string") throw new Error(`snapshot ${path}.tag: expected a string`);
  if (!isRecord(value.props)) throw new Error(`snapshot ${path}.props: expected an object`);
  if (!Array.isArray(value.children)) {
    throw new Error(`snapshot ${path}.children: expected an array`);
  }
  const props: Record<string, SnapshotPropValue> = {};
  for (const [name, prop] of Object.entries(value.props)) {
    if (!isPropValue(prop)) throw new Error(`snapshot ${path}.props.${name}: unsupported value`);
    props[name] = prop;
  }
  // The recorder writes tag names from the same union; an unfamiliar tag from a
  // newer React degrades to "Unknown" rather than failing the whole capture.
  const tag: SnapshotWorkTag = isKnownTag(value.tag) ? value.tag : "Unknown";
  return {
    tag,
    name: readNullableString(value.name, `${path}.name`),
    key: readNullableString(value.key, `${path}.key`),
    text: readNullableString(value.text, `${path}.text`),
    props,
    children: value.children.map((child, index) => readFiber(child, `${path}.children[${index}]`)),
  };
};

const KNOWN_TAGS: ReadonlySet<string> = new Set<SnapshotWorkTag>([
  "FunctionComponent",
  "ClassComponent",
  "HostRoot",
  "HostPortal",
  "HostComponent",
  "HostText",
  "Fragment",
  "Mode",
  "ContextConsumer",
  "ContextProvider",
  "ForwardRef",
  "Profiler",
  "SuspenseComponent",
  "MemoComponent",
  "SimpleMemoComponent",
  "LazyComponent",
  "SuspenseListComponent",
  "OffscreenComponent",
  "HostHoistable",
  "HostSingleton",
  "ViewTransitionComponent",
  "ActivityComponent",
  "CacheComponent",
  "TracingMarkerComponent",
  "LegacyHiddenComponent",
  "ScopeComponent",
  "DehydratedSuspenseComponent",
  "IncompleteClassComponent",
  "IncompleteFunctionComponent",
  "Unknown",
]);

const isKnownTag = (tag: string): tag is SnapshotWorkTag => KNOWN_TAGS.has(tag);

export const parseSnapshot = (json: string): RuntimeSnapshot => {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || !Array.isArray(value.roots)) {
    throw new Error("snapshot: expected { roots: [...] }");
  }
  const buildType =
    value.buildType === "development" || value.buildType === "production" ? value.buildType : null;
  return {
    reactVersion: readNullableString(value.reactVersion ?? null, "reactVersion"),
    rendererName: readNullableString(value.rendererName ?? null, "rendererName"),
    buildType,
    roots: value.roots.map((root, index) => readFiber(root, `roots[${index}]`)),
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : new Date().toISOString(),
  };
};

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
