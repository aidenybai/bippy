import type { SceneEdge, SceneNode } from "../diagram/diagram-scene";
import { getTreeRows, type TreeNode } from "../diagram/tree-model";
import { diagramMetrics } from "../diagram/geometry";

export const chartNodes: TreeNode[] = [
  { id: "chart", label: "Chart" },
  { id: "provider", label: "DefsProvider", parentId: "chart", ownerId: "chart", kind: "provider" },
  { id: "defs", label: "Defs", parentId: "provider", ownerId: "chart" },
  { id: "host-defs", label: "defs", parentId: "defs", ownerId: "defs", kind: "host" },
  { id: "arrow", label: "Arrow", parentId: "provider", ownerId: "chart" },
  { id: "portal", label: "DefsPortal", parentId: "arrow", ownerId: "arrow", kind: "portal" },
  { id: "marker", label: "marker", parentId: "portal", ownerId: "portal", kind: "host" },
  { id: "path", label: "path", parentId: "arrow", ownerId: "arrow", kind: "host" },
];

const domNodes: TreeNode[] = [
  { id: "svg", label: "<svg>", kind: "host" },
  { id: "defs", label: "<defs>", parentId: "svg", kind: "host", isPortalTarget: true },
  { id: "marker", label: "<marker>", annotation: "#arrow", parentId: "defs", kind: "host" },
  { id: "group", label: "<g>", parentId: "svg", kind: "host" },
  { id: "path", label: "<path>", parentId: "group", kind: "host" },
];

interface SceneTreeOptions {
  nodes: readonly TreeNode[];
  prefix: string;
  left: number;
}

const getSceneTree = ({ nodes, prefix, left }: SceneTreeOptions) => {
  const rows = getTreeRows(nodes);
  const sceneNodes: SceneNode[] = rows.map((row, index) => ({
    ...row.node,
    id: `${prefix}-${row.node.id}`,
    description: `${prefix === "dom" ? "DOM" : prefix} tree.`,
    parentId: row.node.parentId ? `${prefix}-${row.node.parentId}` : undefined,
    ownerId: row.node.ownerId ? `${prefix}-${row.node.ownerId}` : undefined,
    x: left + row.depth * diagramMetrics.indent,
    y: 40 + index * diagramMetrics.rowHeight,
  }));
  const edges: SceneEdge[] = rows.flatMap((row) =>
    row.node.parentId === undefined
      ? []
      : [
          {
            id: `${prefix}-${row.node.id}-parent`,
            from: `${prefix}-${row.node.parentId}`,
            to: `${prefix}-${row.node.id}`,
          },
        ],
  );
  return { nodes: sceneNodes, edges };
};

const parentScene = getSceneTree({ nodes: chartNodes, prefix: "parent", left: 48 });
const ownerScene = getSceneTree({
  nodes: chartNodes.map((node) => ({ ...node, parentId: node.ownerId })),
  prefix: "owner",
  left: 360,
});
const domScene = getSceneTree({ nodes: domNodes, prefix: "dom", left: 672 });

export const relationshipNodes = [...parentScene.nodes, ...ownerScene.nodes, ...domScene.nodes];
export const relationshipEdges: SceneEdge[] = [
  ...parentScene.edges,
  ...ownerScene.edges,
  ...domScene.edges,
  ...chartNodes
    .filter((node) => node.ownerId && node.ownerId !== node.parentId)
    .map((node): SceneEdge => ({
      id: `owner-${node.id}`,
      from: `parent-${node.ownerId}`,
      to: `parent-${node.id}`,
      kind: "owner",
    })),
  {
    id: "portal-ref",
    from: "owner-provider",
    to: "dom-defs",
    kind: "portal",
    label: "ref callback",
    bend: 56,
  },
  {
    id: "marker-ref",
    from: "dom-path",
    to: "dom-marker",
    kind: "reference",
    label: "url(#arrow)",
    side: "right",
  },
];

export const parentNodes: TreeNode[] = [
  { id: "strict", label: "StrictMode", kind: "special" },
  { id: "app", label: "DemoApp", parentId: "strict", componentType: "function" },
  {
    id: "theme",
    label: "ThemeContext.Provider",
    parentId: "app",
    ownerId: "app",
    kind: "provider",
  },
  {
    id: "error",
    label: "ErrorBoundary",
    componentType: "class",
    parentId: "theme",
    ownerId: "app",
    kind: "boundary",
  },
  {
    id: "frame",
    label: "Frame",
    parentId: "error",
    ownerId: "app",
    componentType: "forward-ref",
  },
  { id: "div", label: "div", parentId: "frame", ownerId: "frame", kind: "host" },
  {
    id: "aside",
    label: "aside",
    parentId: "div",
    ownerId: "frame",
    kind: "host",
  },
  {
    id: "suspense",
    label: "Suspense",
    parentId: "aside",
    ownerId: "app",
    kind: "suspense",
  },
  {
    id: "profiler",
    label: "Profiler",
    parentId: "suspense",
    ownerId: "app",
    kind: "special",
  },
  {
    id: "stats",
    label: "Stats",
    componentType: "function",
    parentId: "profiler",
    ownerId: "app",
    contextProviderIds: ["theme"],
  },
  {
    id: "section",
    label: "section",
    parentId: "stats",
    ownerId: "stats",
    kind: "host",
  },
  {
    id: "strong",
    label: "strong",
    parentId: "section",
    ownerId: "stats",
    kind: "host",
  },
  {
    id: "main",
    label: "main",
    parentId: "div",
    ownerId: "frame",
    kind: "host",
  },
  {
    id: "activity",
    label: "Activity",
    annotation: "visible",
    parentId: "main",
    ownerId: "app",
  },
  {
    id: "feed-error",
    label: "ErrorBoundary",
    componentType: "class",
    parentId: "activity",
    ownerId: "app",
    kind: "boundary",
  },
  {
    id: "feed",
    label: "Feed",
    parentId: "feed-error",
    ownerId: "app",
    componentType: "function",
  },
  { id: "list", label: "ul", parentId: "feed", ownerId: "feed", kind: "host" },
  {
    id: "post-1",
    label: "Post",
    componentType: "function",
    parentId: "list",
    ownerId: "app",
    contextProviderIds: ["theme"],
  },
  {
    id: "item-1",
    label: "li",
    parentId: "post-1",
    ownerId: "post-1",
    kind: "host",
  },
  {
    id: "post-2",
    label: "Post",
    componentType: "memo",
    parentId: "list",
    ownerId: "app",
    contextProviderIds: ["theme"],
  },
  {
    id: "item-2",
    label: "li",
    parentId: "post-2",
    ownerId: "post-2",
    kind: "host",
  },
  {
    id: "fragment",
    label: "Fragment",
    parentId: "main",
    ownerId: "app",
    kind: "special",
  },
  {
    id: "button",
    label: "button",
    parentId: "fragment",
    ownerId: "app",
    kind: "host",
  },
  {
    id: "button-2",
    label: "button",
    parentId: "fragment",
    ownerId: "app",
    kind: "host",
  },
];

const deepLabels = [
  "Layout",
  "ErrorBoundary",
  "Suspense",
  "Route",
  "Context.Provider",
  "section",
  "Stack",
  "Content",
];

interface StressFixtureOptions {
  prefix: string;
  getParentIndex: (index: number) => number;
}

const getStressNodes = ({ prefix, getParentIndex }: StressFixtureOptions): TreeNode[] =>
  Array.from({ length: 10_000 }, (_, index) => ({
    id: `${prefix}-${index}`,
    label: index === 0 ? "Application" : deepLabels[index % deepLabels.length],
    parentId: index === 0 ? undefined : `${prefix}-${getParentIndex(index)}`,
    kind:
      index % deepLabels.length === 1
        ? "boundary"
        : index % deepLabels.length === 2
          ? "suspense"
          : index % deepLabels.length === 4
            ? "provider"
            : index % deepLabels.length === 5
              ? "host"
              : "component",
  }));

export const deepNodes = getStressNodes({ prefix: "deep", getParentIndex: (index) => index - 1 });
export const branchingNodes = getStressNodes({
  prefix: "branch",
  getParentIndex: (index) => Math.floor((index - 1) / 3),
});
