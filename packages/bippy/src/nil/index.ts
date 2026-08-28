import type * as React from "react";
import { createReconciler } from "../reconciler/index.js";
import type { ReconcilerRoot } from "../reconciler/index.js";

export { act, flushSyncWork, startTransition } from "../reconciler/index.js";

export interface NilNode<P = Record<string, unknown>> {
  type: string;
  props: P;
  children: NilNode[];
}

export interface NilContainer {
  head: NilNode | null;
  children: NilNode[];
}

const removeFromChildren = (children: NilNode[], child: NilNode): void => {
  const childIndex = children.indexOf(child);
  if (childIndex !== -1) children.splice(childIndex, 1);
};

const insertIntoChildren = (children: NilNode[], child: NilNode, beforeChild: NilNode): void => {
  removeFromChildren(children, child);
  const beforeIndex = children.indexOf(beforeChild);
  children.splice(beforeIndex === -1 ? children.length : beforeIndex, 0, child);
};

const nilReconciler = createReconciler({
  createInstance: (type, props) => ({
    type: String(type),
    props,
    children: [],
  }),
  createTextInstance: (text) => ({
    type: "text",
    props: { text },
    children: [],
  }),
  finalizeInitialChildren: () => false,
  getPublicInstance: (instance) => instance,
  appendChild: (parent: NilNode, child: NilNode) => {
    removeFromChildren(parent.children, child);
    parent.children.push(child);
  },
  appendInitialChild: (parent: NilNode, child: NilNode) => {
    removeFromChildren(parent.children, child);
    parent.children.push(child);
  },
  appendChildToContainer: (container: NilContainer, child: NilNode) => {
    removeFromChildren(container.children, child);
    container.children.push(child);
    container.head = container.children[0] ?? null;
  },
  insertBefore: (parent: NilNode, child: NilNode, beforeChild: NilNode) => {
    insertIntoChildren(parent.children, child, beforeChild);
  },
  insertInContainerBefore: (container: NilContainer, child: NilNode, beforeChild: NilNode) => {
    insertIntoChildren(container.children, child, beforeChild);
    container.head = container.children[0] ?? null;
  },
  removeChild: (parent: NilNode, child: NilNode) => {
    removeFromChildren(parent.children, child);
  },
  removeChildFromContainer: (container: NilContainer, child: NilNode) => {
    removeFromChildren(container.children, child);
    container.head = container.children[0] ?? null;
  },
  clearContainer: (container: NilContainer) => {
    container.children.length = 0;
    container.head = null;
  },
  commitTextUpdate: (textInstance: NilNode, _oldText, newText) => {
    textInstance.props = { text: newText };
  },
  commitUpdate: (instance: NilNode, _type, _prevProps, nextProps: Record<string, unknown>) => {
    instance.props = nextProps;
  },
});

const containerRoots = new Map<NilContainer, ReconcilerRoot>();

export const render = (element: React.ReactNode, container?: NilContainer): NilContainer => {
  const hostContainer: NilContainer = container ?? { head: null, children: [] };
  let root = containerRoots.get(hostContainer);
  if (root === undefined) {
    root = nilReconciler.createContainer(hostContainer);
    containerRoots.set(hostContainer, root);
  }
  nilReconciler.updateContainerSync(element, root);
  return hostContainer;
};

export const unmountComponentAtNode = (container: NilContainer): void => {
  const root = containerRoots.get(container);
  if (root === undefined) return;
  nilReconciler.updateContainerSync(null, root);
  containerRoots.delete(container);
};

export const createPortal = (
  children: React.ReactNode,
  containerInfo: NilContainer,
): React.ReactPortal => nilReconciler.createPortal(children, containerInfo);
