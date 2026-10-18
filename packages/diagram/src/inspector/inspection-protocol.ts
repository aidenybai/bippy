import type { TreeNode } from "../diagram/tree-model";
import { getTreeRows } from "../diagram/tree-model";
import { getDataflowIndex, type DataflowEdge } from "../diagram/dataflow-model";

export const maxCapturedFibers = 50000;

export interface FiberTreeNode extends TreeNode {
  tag: number;
}

export interface CapturedFiberRoot {
  id: string;
  rendererId: number;
  reactVersion: string;
  build: "development" | "production";
  nodes: FiberTreeNode[];
  details: TreeNode[];
  edges: DataflowEdge[];
  truncated: boolean;
}

export interface FiberCapture {
  documentId: string;
  truncated: boolean;
  roots: CapturedFiberRoot[];
}

export interface InspectionFrame extends FiberCapture {
  id: string;
  url: string;
}

export interface InspectionMessage {
  type: "bippy:inspection";
  sequence: number;
  capturedAt: number;
  target: string;
  status: "loading" | "live" | "closed" | "error";
  error?: string;
  frames: InspectionFrame[];
}

interface UnknownRecord {
  [key: string]: unknown;
}

const getIsRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const getIsName = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const getIsOptionalName = (value: unknown) => value === undefined || getIsName(value);
const nodeFields = new Set([
  "id",
  "label",
  "parentId",
  "ownerId",
  "kind",
  "componentType",
  "tag",
  "contextProviderIds",
]);
const rootFields = new Set([
  "id",
  "rendererId",
  "reactVersion",
  "build",
  "nodes",
  "details",
  "edges",
  "truncated",
]);
const detailFields = new Set([
  "id",
  "label",
  "parentId",
  "ownerId",
  "componentId",
  "kind",
  "isCallable",
]);
const edgeFields = new Set(["id", "from", "to", "kind", "label"]);

const getIsDetail = (value: unknown): value is TreeNode =>
  getIsRecord(value) &&
  Object.keys(value).every((key) => detailFields.has(key)) &&
  getIsName(value.id) &&
  getIsName(value.label) &&
  getIsName(value.componentId) &&
  value.parentId === value.componentId &&
  value.ownerId === value.componentId &&
  (value.isCallable === undefined || typeof value.isCallable === "boolean") &&
  ["value", "hook", "callback", "store"].includes(String(value.kind));

const getIsFlowEdge = (value: unknown): value is DataflowEdge =>
  getIsRecord(value) &&
  Object.keys(value).every((key) => edgeFields.has(key)) &&
  getIsName(value.id) &&
  getIsName(value.from) &&
  getIsName(value.to) &&
  getIsName(value.label) &&
  ["data", "update", "context", "subscription"].includes(String(value.kind));
const nodeKinds = new Set([
  "component",
  "host",
  "provider",
  "boundary",
  "special",
  "suspense",
  "portal",
]);
const componentTypes = new Set(["function", "class", "memo", "forward-ref"]);

const getIsCapturedNode = (value: unknown): value is FiberTreeNode =>
  getIsRecord(value) &&
  Object.keys(value).every((key) => nodeFields.has(key)) &&
  getIsName(value.id) &&
  getIsName(value.label) &&
  getIsOptionalName(value.parentId) &&
  getIsOptionalName(value.ownerId) &&
  (value.kind === undefined || (typeof value.kind === "string" && nodeKinds.has(value.kind))) &&
  (value.componentType === undefined ||
    (typeof value.componentType === "string" && componentTypes.has(value.componentType))) &&
  Number.isSafeInteger(value.tag) &&
  (value.contextProviderIds === undefined ||
    (Array.isArray(value.contextProviderIds) &&
      value.contextProviderIds.length <= 64 &&
      value.contextProviderIds.every(getIsName)));

const getIsCapturedRoot = (value: unknown): value is CapturedFiberRoot => {
  if (
    !getIsRecord(value) ||
    !Object.keys(value).every((key) => rootFields.has(key)) ||
    !getIsName(value.id) ||
    !Number.isSafeInteger(value.rendererId) ||
    !getIsName(value.reactVersion) ||
    (value.build !== "development" && value.build !== "production") ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > maxCapturedFibers ||
    !value.nodes.every(getIsCapturedNode) ||
    !Array.isArray(value.details) ||
    value.nodes.length + value.details.length > maxCapturedFibers ||
    !value.details.every(getIsDetail) ||
    !Array.isArray(value.edges) ||
    value.edges.length > maxCapturedFibers * 2 ||
    !value.edges.every(getIsFlowEdge)
  )
    return false;
  try {
    const nodes = [...value.nodes, ...value.details];
    getTreeRows(nodes);
    getTreeRows(nodes.map((node) => ({ ...node, parentId: node.ownerId })));
    getDataflowIndex(nodes, value.edges);
    const fibers = new Map(value.nodes.map((node) => [node.id, node]));
    if (
      value.details.some((node) => !fibers.has(node.componentId ?? "")) ||
      value.nodes.some((node) =>
        node.contextProviderIds?.some((id) => fibers.get(id)?.kind !== "provider"),
      )
    )
      return false;
    return true;
  } catch {
    return false;
  }
};

export const getIsFiberCapture = (value: unknown): value is FiberCapture =>
  getIsRecord(value) &&
  getIsName(value.documentId) &&
  typeof value.truncated === "boolean" &&
  Array.isArray(value.roots) &&
  value.roots.length <= 100 &&
  value.roots.every(getIsCapturedRoot) &&
  value.roots.reduce((count, root) => count + root.nodes.length + root.details.length, 0) <=
    maxCapturedFibers &&
  new Set(value.roots.map((root) => root.id)).size === value.roots.length;

export const getIsInspectionMessage = (value: unknown): value is InspectionMessage =>
  getIsRecord(value) &&
  value.type === "bippy:inspection" &&
  Number.isSafeInteger(value.sequence) &&
  typeof value.capturedAt === "number" &&
  Number.isFinite(value.capturedAt) &&
  typeof value.target === "string" &&
  value.target.length <= 2048 &&
  typeof value.status === "string" &&
  ["loading", "live", "closed", "error"].includes(value.status) &&
  getIsOptionalName(value.error) &&
  Array.isArray(value.frames) &&
  value.frames.length <= 100 &&
  value.frames.every(
    (frame) =>
      getIsRecord(frame) &&
      getIsName(frame.id) &&
      typeof frame.url === "string" &&
      frame.url.length <= 2048 &&
      getIsFiberCapture(frame),
  );
