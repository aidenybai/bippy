import type { FiberSnapshot, NodeSnapshot } from "./types.js";

export interface RenderTreeOptions {
  showIds?: boolean;
  showLocations?: boolean;
  showHooks?: boolean;
}

interface TreeLine {
  label: string;
  children: TreeLine[];
}

const TAG_HINTS: Partial<Record<NonNullable<FiberSnapshot["tag"]>, string>> = {
  ClassComponent: "class",
  ForwardRef: "forwardRef",
  MemoComponent: "memo",
  SimpleMemoComponent: "memo",
  HostHoistable: "hoistable",
  HostSingleton: "singleton",
  HostPortal: "portal",
};

const shortenLocation = (location: string): string => {
  const segments = location.split("/");
  return segments.slice(-2).join("/");
};

const describeHooks = (hooks: FiberSnapshot["hooks"]): string | null => {
  if (hooks === null) return null;
  if (typeof hooks === "number") return hooks === 0 ? null : `{${hooks} hook${hooks === 1 ? "" : "s"}}`;
  return hooks.length === 0 ? null : `{${hooks.join(", ")}}`;
};

export const formatFiberLabel = (fiber: FiberSnapshot, options: RenderTreeOptions = {}): string => {
  const parts: string[] = [];
  if (fiber.tag === "HostText") parts.push(fiber.text === null ? '"?"' : JSON.stringify(fiber.text));
  else if (fiber.tag === "HostRoot") parts.push("HostRoot");
  else parts.push(fiber.name ?? (fiber.tag === "Fragment" ? "Fragment" : "Anonymous"));
  if (fiber.tag === null) parts.push("(?)");
  else {
    const hint = TAG_HINTS[fiber.tag];
    if (hint) parts.push(`(${hint})`);
  }
  if (fiber.key !== null) parts.push(`key=${JSON.stringify(fiber.key)}`);
  if (fiber.annotations.length > 0) parts.push(`[${fiber.annotations.join(", ")}]`);
  if (options.showHooks) {
    const hooks = describeHooks(fiber.hooks);
    if (hooks) parts.push(hooks);
  }
  if (options.showIds) parts.push(`#${fiber.id}`);
  if (options.showLocations && fiber.location) parts.push(`@ ${shortenLocation(fiber.location)}`);
  return parts.join(" ");
};

const toTreeLines = (nodes: NodeSnapshot[], options: RenderTreeOptions): TreeLine[] =>
  nodes.map((node) => toTreeLine(node, options));

const toTreeLine = (node: NodeSnapshot, options: RenderTreeOptions): TreeLine => {
  switch (node.kind) {
    case "fiber": {
      const children = toTreeLines(node.children, options);
      if (node.fallback) {
        children.push({ label: "fallback:", children: toTreeLines(node.fallback, options) });
      }
      return { label: formatFiberLabel(node, options), children };
    }
    case "branch":
      return {
        label: `? ${node.test}`,
        children: node.alternatives.map((alternative, index) => ({
          label: `${index === 0 ? "then" : index === node.alternatives.length - 1 ? "else" : `case ${index}`}:${
            alternative.length === 0 ? " ∅" : ""
          }`,
          children: toTreeLines(alternative, options),
        })),
      };
    case "list":
      return { label: `* ${node.description}`, children: toTreeLines(node.items, options) };
    case "unknown":
      return { label: `… ${node.description}`, children: [] };
  }
};

const renderLines = (lines: TreeLine[], prefix: string, output: string[]): void => {
  lines.forEach((line, index) => {
    const isLast = index === lines.length - 1;
    output.push(`${prefix}${isLast ? "└─ " : "├─ "}${line.label}`);
    renderLines(line.children, `${prefix}${isLast ? "   " : "│  "}`, output);
  });
};

const renderTree = (root: TreeLine): string => {
  const output = [root.label];
  renderLines(root.children, "", output);
  return output.join("\n");
};

/** Parent tree: fibers nested by `return`, with branches and lists shown inline. */
export const renderSnapshotTree = (root: NodeSnapshot, options: RenderTreeOptions = {}): string =>
  renderTree(toTreeLine(root, options));

const collectFibers = (nodes: NodeSnapshot[], output: FiberSnapshot[]): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        output.push(node);
        collectFibers(node.children, output);
        if (node.fallback) collectFibers(node.fallback, output);
        break;
      case "branch":
        for (const alternative of node.alternatives) collectFibers(alternative, output);
        break;
      case "list":
        collectFibers(node.items, output);
        break;
      case "unknown":
        break;
    }
  }
};

/** Owner tree: fibers nested by the component whose render created them. */
export const renderOwnerTree = (root: FiberSnapshot, options: RenderTreeOptions = {}): string => {
  const fibers: FiberSnapshot[] = [];
  collectFibers([root], fibers);
  const byOwner = new Map<number | null, FiberSnapshot[]>();
  for (const fiber of fibers) {
    const owned = byOwner.get(fiber.owner) ?? [];
    owned.push(fiber);
    byOwner.set(fiber.owner, owned);
  }
  const toOwnerLine = (fiber: FiberSnapshot): TreeLine => ({
    label: formatFiberLabel(fiber, options),
    children: (byOwner.get(fiber.id) ?? []).filter((owned) => owned !== fiber).map(toOwnerLine),
  });
  const roots = (byOwner.get(null) ?? []).filter((fiber) => fiber !== root);
  return renderTree({ label: formatFiberLabel(root, options), children: roots.map(toOwnerLine) });
};
