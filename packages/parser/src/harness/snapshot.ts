// Shared, JSON-serializable tree shape produced by both the static renderer and
// runtime capture. Keeping this file free of Node imports lets the browser
// injection bundle reuse it.

import { z } from "zod";
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

const snapshotWorkTagSchema = z.enum([
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

// The recorder writes tag names from the same union; an unfamiliar tag from a
// newer React degrades to "Unknown" rather than failing the whole capture.
const fiberSnapshotSchema: z.ZodType<RuntimeFiberSnapshot> = z.lazy(() =>
  z.object({
    tag: z.string().pipe(snapshotWorkTagSchema.catch("Unknown")),
    name: z.string().nullable(),
    key: z.string().nullable(),
    text: z.string().nullable(),
    props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    children: z.array(fiberSnapshotSchema),
  }),
);

const snapshotSchema: z.ZodType<RuntimeSnapshot> = z.object({
  reactVersion: z.string().nullable().default(null),
  rendererName: z.string().nullable().default(null),
  buildType: z.enum(["development", "production"]).nullable().catch(null),
  roots: z.array(fiberSnapshotSchema),
  capturedAt: z.string().catch(() => new Date().toISOString()),
});

export const parseSnapshot = (json: string): RuntimeSnapshot => readSnapshot(JSON.parse(json));

export const readSnapshot = (value: unknown): RuntimeSnapshot => {
  const snapshot = snapshotSchema.safeParse(value);
  if (!snapshot.success) throw new Error(`snapshot: ${z.prettifyError(snapshot.error)}`);
  return snapshot.data;
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
