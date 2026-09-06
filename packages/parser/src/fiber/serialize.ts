import { describeValue } from "../evaluate/values.js";
import type { SourceLocation, StaticFiber, StaticObjectValue } from "../types.js";
import type { WorkTag } from "../work-tags.js";

export interface SerializedFiberBase {
  kind: StaticFiber["kind"];
  index: number;
  location: SourceLocation | null;
}

export interface SerializedElementFiber extends SerializedFiberBase {
  kind: "fiber";
  tag: WorkTag;
  name: string | null;
  key: string | null;
  props: Record<string, string>;
  notes: string[];
  children: SerializedFiber[];
}

export interface SerializedTextFiber extends SerializedFiberBase {
  kind: "text";
  text: string | null;
}

export interface SerializedBranchFiber extends SerializedFiberBase {
  kind: "branch";
  reason: string;
  preferredIndex: number | null;
  alternatives: SerializedFiber[][];
}

export interface SerializedRepeatFiber extends SerializedFiberBase {
  kind: "repeat";
  children: SerializedFiber[];
}

export interface SerializedOpaqueFiber extends SerializedFiberBase {
  kind: "opaque";
  name: string;
  packageName: string | null;
  key: string | null;
  props: Record<string, string>;
  reason: string;
  passedChildren: SerializedFiber[];
}

export interface SerializedUnknownFiber extends SerializedFiberBase {
  kind: "unknown";
  reason: string;
}

export type SerializedFiber =
  | SerializedElementFiber
  | SerializedTextFiber
  | SerializedBranchFiber
  | SerializedRepeatFiber
  | SerializedOpaqueFiber
  | SerializedUnknownFiber;

const HIDDEN_PROPS = new Set(["children"]);

export const serializeProps = (props: StaticObjectValue): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const entry of props.entries) {
    if (entry.kind === "spread") {
      result["..."] = describeValue(entry.value);
      continue;
    }
    if (HIDDEN_PROPS.has(entry.key)) continue;
    result[entry.key] = describeValue(entry.value);
  }
  return result;
};

export const collectChildren = (first: StaticFiber | null): StaticFiber[] => {
  const children: StaticFiber[] = [];
  let current = first;
  while (current) {
    children.push(current);
    current = current.sibling;
  }
  return children;
};

export const serializeFiber = (fiber: StaticFiber): SerializedFiber => {
  const base = { index: fiber.index, location: fiber.location };
  switch (fiber.kind) {
    case "fiber":
      return {
        ...base,
        kind: "fiber",
        tag: fiber.tag,
        name: fiber.displayName,
        key: fiber.key,
        props: serializeProps(fiber.props),
        notes: fiber.notes,
        children: collectChildren(fiber.child).map(serializeFiber),
      };
    case "text":
      return { ...base, kind: "text", text: fiber.text };
    case "branch":
      return {
        ...base,
        kind: "branch",
        reason: fiber.reason,
        preferredIndex: fiber.preferredIndex,
        alternatives: fiber.alternatives.map((alternative) =>
          collectChildren(alternative).map(serializeFiber),
        ),
      };
    case "repeat":
      return {
        ...base,
        kind: "repeat",
        children: collectChildren(fiber.child).map(serializeFiber),
      };
    case "opaque":
      return {
        ...base,
        kind: "opaque",
        name: fiber.displayName,
        packageName: fiber.packageName,
        key: fiber.key,
        props: serializeProps(fiber.props),
        reason: fiber.reason,
        passedChildren: collectChildren(fiber.passedChildren).map(serializeFiber),
      };
    case "unknown":
      return { ...base, kind: "unknown", reason: fiber.reason };
  }
};

export interface FormatFiberOptions {
  showProps?: boolean;
  showLocations?: boolean;
  showNotes?: boolean;
  rootDirectory?: string;
}

const formatLocation = (
  location: SourceLocation | null,
  rootDirectory: string | undefined,
): string => {
  if (!location) return "";
  const filePath =
    rootDirectory && location.filePath.startsWith(rootDirectory)
      ? location.filePath.slice(rootDirectory.length).replace(/^[/\\]/, "")
      : location.filePath;
  return ` @ ${filePath}:${location.line}:${location.column}`;
};

const formatProps = (props: Record<string, string>): string => {
  const entries = Object.entries(props);
  if (entries.length === 0) return "";
  return ` {${entries.map(([key, value]) => `${key}=${value}`).join(", ")}}`;
};

export const formatSerializedFiber = (
  fiber: SerializedFiber,
  options: FormatFiberOptions = {},
  depth = 0,
): string => {
  const indent = "  ".repeat(depth);
  const location = options.showLocations
    ? formatLocation(fiber.location, options.rootDirectory)
    : "";
  const lines: string[] = [];
  switch (fiber.kind) {
    case "fiber": {
      const key = fiber.key === null ? "" : ` key=${JSON.stringify(fiber.key)}`;
      const props = options.showProps ? formatProps(fiber.props) : "";
      lines.push(`${indent}<${fiber.name ?? "?"}>${key}${props}${location}`);
      if (options.showNotes) for (const note of fiber.notes) lines.push(`${indent}  // ${note}`);
      for (const child of fiber.children)
        lines.push(formatSerializedFiber(child, options, depth + 1));
      break;
    }
    case "text":
      lines.push(
        `${indent}${fiber.text === null ? "#text(?)" : JSON.stringify(fiber.text)}${location}`,
      );
      break;
    case "branch":
      lines.push(`${indent}?branch(${fiber.reason})${location}`);
      fiber.alternatives.forEach((alternative, index) => {
        lines.push(`${indent}  |${index}${fiber.preferredIndex === index ? " (preferred)" : ""}`);
        for (const child of alternative)
          lines.push(formatSerializedFiber(child, options, depth + 2));
      });
      break;
    case "repeat":
      lines.push(`${indent}*repeat${location}`);
      for (const child of fiber.children)
        lines.push(formatSerializedFiber(child, options, depth + 1));
      break;
    case "opaque": {
      const key = fiber.key === null ? "" : ` key=${JSON.stringify(fiber.key)}`;
      const props = options.showProps ? formatProps(fiber.props) : "";
      lines.push(`${indent}<${fiber.name}>${key}${props} (opaque: ${fiber.reason})${location}`);
      for (const child of fiber.passedChildren)
        lines.push(formatSerializedFiber(child, options, depth + 1));
      break;
    }
    case "unknown":
      lines.push(`${indent}?unknown(${fiber.reason})${location}`);
      break;
  }
  return lines.join("\n");
};

export const formatFiber = (fiber: StaticFiber, options: FormatFiberOptions = {}): string =>
  formatSerializedFiber(serializeFiber(fiber), options);
