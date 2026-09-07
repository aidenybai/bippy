import type { TreeNode } from "../diagram/tree-model";
import type { DataflowEdge } from "../diagram/dataflow-model";
import { parentNodes } from "./fixtures";

export const treeDataflowPorts: TreeNode[] = [
  {
    id: "query-state",
    label: "useState",
    annotation: 'query · "rea"',
    kind: "hook",
    componentId: "app",
  },
  { id: "set-query", label: "setQuery", kind: "callback", componentId: "app" },
  {
    id: "todos-reducer",
    label: "useReducer",
    annotation: "todos",
    kind: "hook",
    componentId: "app",
  },
  { id: "dispatch", label: "dispatch", kind: "callback", componentId: "app" },
  { id: "visible-todos", label: "visibleTodos", kind: "value", componentId: "app" },
  {
    id: "cart-hook",
    label: "useSyncExternalStore",
    annotation: "snapshot",
    kind: "hook",
    componentId: "app",
  },
  { id: "stats-count", label: "props.count", kind: "value", componentId: "stats" },
  {
    id: "theme-hook",
    label: "useContext",
    annotation: "ThemeContext",
    kind: "hook",
    componentId: "stats",
    contextProviderIds: ["theme"],
  },
  { id: "strong-content", label: "props.children", kind: "value", componentId: "strong" },
  { id: "strong-style", label: "props.style.color", kind: "value", componentId: "strong" },
  { id: "feed-items", label: "props.items", kind: "value", componentId: "feed" },
  {
    id: "feed-toggle",
    label: "props.onToggle",
    kind: "value",
    isCallable: true,
    componentId: "feed",
  },
  { id: "post-item", label: "props.item", kind: "value", componentId: "post-1" },
  {
    id: "post-toggle",
    label: "props.onToggle",
    kind: "value",
    isCallable: true,
    componentId: "post-1",
  },
  {
    id: "item-content",
    label: "props.children",
    annotation: "item.title",
    kind: "value",
    componentId: "item-1",
  },
  {
    id: "item-click",
    label: "props.onClick",
    kind: "value",
    isCallable: true,
    componentId: "item-1",
  },
  {
    id: "cart-click",
    label: "props.onClick",
    annotation: "add to cart",
    kind: "value",
    isCallable: true,
    componentId: "button",
  },
  {
    id: "query-clear",
    label: "props.onClick",
    annotation: "clear query",
    kind: "value",
    isCallable: true,
    componentId: "button-2",
  },
  {
    id: "get-snapshot",
    label: "getSnapshot",
    kind: "store",
    isCallable: true,
    componentId: "cart-store",
  },
  {
    id: "subscribe",
    label: "subscribe",
    kind: "store",
    isCallable: true,
    componentId: "cart-store",
  },
  { id: "store-add", label: "add", kind: "callback", componentId: "cart-store" },
];

const components: TreeNode[] = [
  ...parentNodes,
  { id: "cart-store", label: "cartStore", annotation: "external", kind: "store" },
];

export const treeDataflowNodes: TreeNode[] = components.flatMap((node) => [
  node,
  ...treeDataflowPorts
    .filter((port) => port.componentId === node.id)
    .map((port) => ({ ...port, parentId: node.id, ownerId: node.id })),
]);

export const treeDataflowEdges: DataflowEdge[] = [
  { id: "query-update", from: "query-clear", to: "set-query", kind: "update", label: "call" },
  { id: "state-update", from: "set-query", to: "query-state", kind: "update" },
  { id: "filter-query", from: "query-state", to: "visible-todos", kind: "data", label: "query" },
  { id: "filter-todos", from: "todos-reducer", to: "visible-todos", kind: "data", label: "todos" },
  { id: "items-prop", from: "visible-todos", to: "feed-items", kind: "data", label: "prop" },
  { id: "item-prop", from: "feed-items", to: "post-item", kind: "data", label: "item" },
  { id: "item-render", from: "post-item", to: "item-content", kind: "data", label: "render" },
  { id: "toggle-event", from: "item-click", to: "post-toggle", kind: "update", label: "call" },
  { id: "toggle-callback", from: "post-toggle", to: "feed-toggle", kind: "update", label: "call" },
  { id: "toggle-action", from: "feed-toggle", to: "dispatch", kind: "update", label: "action" },
  { id: "reducer-update", from: "dispatch", to: "todos-reducer", kind: "update" },
  {
    id: "snapshot-prop",
    from: "cart-hook",
    to: "stats-count",
    kind: "data",
    label: "snapshot.count",
  },
  { id: "count-render", from: "stats-count", to: "strong-content", kind: "data", label: "render" },
  { id: "store-read", from: "cart-store", to: "get-snapshot", kind: "data" },
  { id: "snapshot-read", from: "get-snapshot", to: "cart-hook", kind: "data", label: "snapshot" },
  {
    id: "store-subscribe",
    from: "cart-hook",
    to: "subscribe",
    kind: "subscription",
    label: "subscribe / cleanup",
  },
  { id: "store-notify", from: "cart-store", to: "subscribe", kind: "subscription" },
  {
    id: "snapshot-changed",
    from: "subscribe",
    to: "cart-hook",
    kind: "subscription",
    label: "if changed",
  },
  { id: "store-event", from: "cart-click", to: "store-add", kind: "update", label: "call" },
  { id: "store-mutation", from: "store-add", to: "cart-store", kind: "update", label: "write" },
  { id: "context-read", from: "theme", to: "theme-hook", kind: "context", label: "read" },
  { id: "theme-render", from: "theme-hook", to: "strong-style", kind: "data", label: "render" },
];
