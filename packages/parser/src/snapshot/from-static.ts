import type { StaticFiber, StaticNode } from "../fiber/types.js";
import type { SourceLocation } from "../module/location.js";
import type { FiberSnapshot, NodeSnapshot } from "./types.js";

export const formatLocation = (location: SourceLocation | null): string | null =>
  location ? `${location.filePath}:${location.line}:${location.column}` : null;

interface StaticSnapshotState {
  nextId: number;
  ids: WeakMap<StaticFiber, number>;
}

const snapshotFiber = (fiber: StaticFiber, state: StaticSnapshotState): FiberSnapshot => {
  const id = state.nextId++;
  state.ids.set(fiber, id);
  return {
    kind: "fiber",
    id,
    owner: fiber.owner ? (state.ids.get(fiber.owner) ?? null) : null,
    tag: fiber.tag,
    name: fiber.name,
    key: fiber.key,
    text: fiber.text,
    children: snapshotNodes(fiber.children, state),
    hooks: fiber.hooks.map((hook) => hook.name),
    annotations: fiber.annotations,
    fallback: fiber.fallback ? snapshotNodes(fiber.fallback, state) : null,
    location: formatLocation(fiber.location),
  };
};

const snapshotNode = (node: StaticNode, state: StaticSnapshotState): NodeSnapshot => {
  switch (node.kind) {
    case "fiber":
      return snapshotFiber(node, state);
    case "branch":
      return {
        kind: "branch",
        test: node.test,
        alternatives: node.alternatives.map((alternative) => snapshotNodes(alternative, state)),
      };
    case "list":
      return {
        kind: "list",
        description: node.description,
        items: snapshotNodes(node.items, state),
      };
    case "unknown":
      return node;
  }
};

const snapshotNodes = (nodes: StaticNode[], state: StaticSnapshotState): NodeSnapshot[] =>
  nodes.map((node) => snapshotNode(node, state));

/** Serializable projection of a static tree; ids are assigned in pre-order. */
export const snapshotStaticFiber = (root: StaticFiber): FiberSnapshot =>
  snapshotFiber(root, { nextId: 0, ids: new WeakMap() });
