import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it } from "vite-plus/test";
import React from "react";

import { instrument, isFiber } from "../src/index.js";
import type { Fiber } from "../src/index.js";
import { act, createReconciler } from "../src/reconciler/index.js";

interface TestNode {
  type: string;
  props: Record<string, unknown>;
  children: TestNode[];
}

interface TestContainer {
  children: TestNode[];
}

const createTestReconciler = () =>
  createReconciler({
    createInstance: (type, props) => ({ type: String(type), props, children: [] }),
    createTextInstance: (text) => ({ type: "text", props: { text }, children: [] }),
    finalizeInitialChildren: () => false,
    getPublicInstance: (instance) => instance,
    appendChild: (parent: TestNode, child: TestNode) => {
      parent.children.push(child);
    },
    appendChildToContainer: (container: TestContainer, child: TestNode) => {
      container.children.push(child);
    },
    removeChild: (parent: TestNode, child: TestNode) => {
      parent.children.splice(parent.children.indexOf(child), 1);
    },
    removeChildFromContainer: (container: TestContainer, child: TestNode) => {
      container.children.splice(container.children.indexOf(child), 1);
    },
    commitUpdate: (instance: TestNode, _type, _prevProps, nextProps: Record<string, unknown>) => {
      instance.props = nextProps;
    },
  });

it("produces fibers that satisfy bippy's isFiber", async () => {
  const reconciler = createTestReconciler();
  const container: TestContainer = { children: [] };
  const root = reconciler.createContainer(container);

  await act(() => {
    reconciler.updateContainerSync(<node name="fiber-check" />, root);
  });

  expect(isFiber(root.current.child as unknown as Fiber)).toBe(true);
  expect(container.children[0]?.props).toMatchObject({ name: "fiber-check" });
});

it("notifies the bippy devtools hook on commit", async () => {
  const reconciler = createTestReconciler();
  expect(reconciler.injectIntoDevTools({ rendererPackageName: "bippy-test" })).toBe(true);

  const committedRoots: unknown[] = [];
  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererId, fiberRoot) => {
      committedRoots.push(fiberRoot);
    },
  });

  const container: TestContainer = { children: [] };
  const root = reconciler.createContainer(container);
  await act(() => {
    reconciler.updateContainerSync(<node name="devtools" />, root);
  });

  expect(committedRoots.length).toBeGreaterThan(0);
  unsubscribe();
});

it("supports getPublicRootInstance and portals", async () => {
  const reconciler = createTestReconciler();
  const container: TestContainer = { children: [] };
  const portalTarget: TestNode = { type: "portal-target", props: {}, children: [] };
  const root = reconciler.createContainer(container);

  const App = () => (
    <>
      <node name="main" />
      {reconciler.createPortal(<node name="teleported" />, portalTarget)}
    </>
  );

  await act(() => {
    reconciler.updateContainerSync(<App />, root);
  });

  const publicInstance = reconciler.getPublicRootInstance(root) as TestNode | null;
  expect(publicInstance?.props).toMatchObject({ name: "main" });
  expect(portalTarget.children[0]?.props).toMatchObject({ name: "teleported" });
});

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      node: Record<string, unknown>;
    }
  }
}
