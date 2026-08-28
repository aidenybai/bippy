import * as React from "react";
import { expect } from "vite-plus/test";
import { createReconciler } from "../src/reconciler/index.js";
import type { ReconcilerRoot } from "../src/reconciler/index.js";

export { act, flushSyncWork, startTransition } from "../src/reconciler/index.js";

export interface NoopInstance {
  type: string;
  props: Record<string, unknown>;
  children: NoopChild[];
}

export interface NoopTextInstance {
  text: string;
}

export type NoopChild = NoopInstance | NoopTextInstance;

export interface NoopContainer {
  children: NoopChild[];
}

const isTextInstance = (child: NoopChild): child is NoopTextInstance => "text" in child;

const removeFromChildren = (children: NoopChild[], child: NoopChild): void => {
  const childIndex = children.indexOf(child);
  if (childIndex !== -1) children.splice(childIndex, 1);
};

const insertIntoChildren = (
  children: NoopChild[],
  child: NoopChild,
  beforeChild: NoopChild,
): void => {
  removeFromChildren(children, child);
  const beforeIndex = children.indexOf(beforeChild);
  children.splice(beforeIndex === -1 ? children.length : beforeIndex, 0, child);
};

const getInstanceProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const { children: _instanceChildren, ...instanceProps } = props;
  return instanceProps;
};

const noopReconciler = createReconciler({
  createInstance: (type, props: Record<string, unknown>) => ({
    type: String(type),
    props: getInstanceProps(props),
    children: [],
  }),
  createTextInstance: (text) => ({ text }),
  finalizeInitialChildren: () => false,
  getPublicInstance: (instance) => instance,
  appendChild: (parent: NoopInstance, child: NoopChild) => {
    removeFromChildren(parent.children, child);
    parent.children.push(child);
  },
  appendInitialChild: (parent: NoopInstance, child: NoopChild) => {
    removeFromChildren(parent.children, child);
    parent.children.push(child);
  },
  appendChildToContainer: (container: NoopContainer, child: NoopChild) => {
    removeFromChildren(container.children, child);
    container.children.push(child);
  },
  insertBefore: (parent: NoopInstance, child: NoopChild, beforeChild: NoopChild) => {
    insertIntoChildren(parent.children, child, beforeChild);
  },
  insertInContainerBefore: (container: NoopContainer, child: NoopChild, beforeChild: NoopChild) => {
    insertIntoChildren(container.children, child, beforeChild);
  },
  removeChild: (parent: NoopInstance, child: NoopChild) => {
    removeFromChildren(parent.children, child);
  },
  removeChildFromContainer: (container: NoopContainer, child: NoopChild) => {
    removeFromChildren(container.children, child);
  },
  clearContainer: (container: NoopContainer) => {
    container.children.length = 0;
  },
  commitTextUpdate: (textInstance: NoopTextInstance, _oldText, newText) => {
    textInstance.text = newText;
  },
  commitUpdate: (instance: NoopInstance, _type, _prevProps, nextProps: Record<string, unknown>) => {
    instance.props = getInstanceProps(nextProps);
  },
});

export interface NoopRoot {
  container: NoopContainer;
  render(element: React.ReactNode, callback?: (() => void) | null): void;
  unmount(): void;
  getChildren(): NoopChild[];
  getPublicRootInstance(): unknown;
}

export const createNoopRoot = (): NoopRoot => {
  const container: NoopContainer = { children: [] };
  const root: ReconcilerRoot = noopReconciler.createContainer(container);
  return {
    container,
    render: (element, callback) => noopReconciler.updateContainer(element, root, null, callback),
    unmount: () => noopReconciler.updateContainerSync(null, root),
    getChildren: () => container.children,
    getPublicRootInstance: () => noopReconciler.getPublicRootInstance(root),
  };
};

export const createPortal = noopReconciler.createPortal;

interface ComparableNode {
  type: unknown;
  props: Record<string, unknown>;
  children: (ComparableNode | string)[];
}

const normalizeExpectedChildren = (children: unknown): (ComparableNode | string)[] => {
  if (children === null || children === undefined || typeof children === "boolean") return [];
  if (typeof children === "string" || typeof children === "number") return [String(children)];
  if (Array.isArray(children)) return children.flatMap(normalizeExpectedChildren);
  if (
    typeof children === "object" &&
    typeof (children as Iterable<unknown>)[Symbol.iterator] === "function"
  ) {
    return [...(children as Iterable<unknown>)].flatMap(normalizeExpectedChildren);
  }

  const element = children as React.ReactElement<Record<string, unknown>>;
  if (element.type === React.Fragment) {
    return normalizeExpectedChildren(element.props.children);
  }
  const { children: elementChildren, ref: _elementRef, ...elementProps } = element.props;
  return [
    {
      type: element.type,
      props: elementProps,
      children: normalizeExpectedChildren(elementChildren),
    },
  ];
};

const normalizeActualChildren = (children: NoopChild[]): (ComparableNode | string)[] =>
  children.map((child) =>
    isTextInstance(child)
      ? child.text
      : {
          type: child.type,
          props: child.props,
          children: normalizeActualChildren(child.children),
        },
  );

export const expectRenderedOutput = (root: NoopRoot, expected: React.ReactNode): void => {
  expect(normalizeActualChildren(root.getChildren())).toEqual(normalizeExpectedChildren(expected));
};

const schedulerLogs: unknown[] = [];

export const log = (value: unknown): void => {
  schedulerLogs.push(value);
};

export const assertLog = (expected: unknown[]): void => {
  const currentLogs = [...schedulerLogs];
  schedulerLogs.length = 0;
  expect(currentLogs).toEqual(expected);
};
