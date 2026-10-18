import assert from "node:assert/strict";
import { test } from "node:test";
import { getReactWorkTags, setReactWorkTagsForFiber, isFiber, type Fiber } from "bippy";
import { getFiberSnapshot } from "../src/inspector/fiber-snapshot";
import { getIsFiberCapture, getIsInspectionMessage } from "../src/inspector/inspection-protocol";
import { getTreeRows } from "../src/diagram/tree-model";
import { createContext } from "react";

const getFiber = (tag: number, name = "Example"): Fiber => {
  const fiber = {
    tag,
    key: null,
    elementType: name,
    type: name,
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    index: 0,
    ref: null,
    pendingProps: {},
    memoizedProps: {},
    updateQueue: null,
    memoizedState: null,
    dependencies: null,
    mode: 0,
    flags: 0,
    subtreeFlags: 0,
    deletions: null,
    lanes: 0,
    childLanes: 0,
    alternate: null,
    nextEffect: null,
    firstEffect: null,
    lastEffect: null,
  };
  if (!isFiber(fiber)) throw new Error("Invalid fixture fiber");
  return fiber;
};

const getExample = (version = "19.2.0") => {
  const tags = getReactWorkTags(version);
  const root = getFiber(tags.HostRoot, "Root");
  setReactWorkTagsForFiber(root, { version, bundleType: 1, rendererPackageName: "react-dom" });
  const parent = getFiber(tags.FunctionComponent, "Parent");
  const layout = getFiber(tags.FunctionComponent, "Layout");
  const child = getFiber(tags.SimpleMemoComponent, "Child");
  root.child = parent;
  parent.return = root;
  parent.child = layout;
  layout.return = parent;
  layout.child = child;
  child.return = layout;
  child._debugOwner = parent;
  return { root, parent, layout, child };
};

test("captures actual parent and debug-owner relationships separately", () => {
  const { root } = getExample();
  const { nodes } = getFiberSnapshot(root);
  const child = nodes.find((node) => node.label === "Child");
  assert.equal(child?.parentId, nodes.find((node) => node.label === "Layout")?.id);
  assert.equal(child?.ownerId, nodes.find((node) => node.label === "Parent")?.id);
  assert.equal(child?.componentType, "memo");
  assert.equal(nodes.find((node) => node.label === "Parent")?.componentType, "function");
  assert.equal(getTreeRows(nodes).length, 4);
});

test("uses bippy IDs across alternate swaps and omits server-only owners", () => {
  const { root, child } = getExample();
  const previous = getFiberSnapshot(root).nodes.at(-1)?.id;
  const alternate = getFiber(child.tag, "Child");
  alternate.alternate = child;
  child.alternate = alternate;
  assert.equal(getFiberSnapshot(alternate).nodes[0].id, previous);
  child._debugOwner = { name: "ServerOwner", env: "Server" };
  assert.equal(getFiberSnapshot(root).nodes.at(-1)?.ownerId, undefined);
});

test("uses renderer-version work tags and does not guess missing production owners", () => {
  const { root, child } = getExample("18.2.0");
  child._debugOwner = undefined;
  const nodes = getFiberSnapshot(root).nodes;
  assert.equal(nodes.at(-1)?.componentType, "memo");
  assert.equal(nodes.at(-1)?.ownerId, undefined);
  assert.equal(nodes[0].label, "Root");
});

test("marks real error handlers, hosts, text, providers, suspense, and portals", () => {
  const tags = getReactWorkTags();
  const boundary = getFiber(tags.ClassComponent);
  boundary.stateNode = { componentDidCatch: () => undefined };
  assert.equal(getFiberSnapshot(boundary).nodes[0].kind, "boundary");
  assert.equal(getFiberSnapshot(getFiber(tags.ClassComponent)).nodes[0].kind, "component");
  assert.equal(getFiberSnapshot(getFiber(tags.ForwardRef)).nodes[0].componentType, "forward-ref");
  assert.equal(getFiberSnapshot(getFiber(tags.HostComponent, "button")).nodes[0].kind, "host");
  assert.equal(getFiberSnapshot(getFiber(tags.HostText, "private-value")).nodes[0].label, "#text");
  assert.equal(getFiberSnapshot(getFiber(tags.ContextProvider)).nodes[0].kind, "provider");
  assert.equal(getFiberSnapshot(getFiber(tags.SuspenseComponent)).nodes[0].kind, "suspense");
  assert.equal(getFiberSnapshot(getFiber(tags.HostPortal)).nodes[0].kind, "portal");
});

test("bounded iterative capture keeps parents intact without reading props or state values", () => {
  const { root, child } = getExample();
  let parent = child;
  for (let index = 0; index < 10000; index++) {
    const next = getFiber(child.tag);
    parent.child = next;
    next.return = parent;
    parent = next;
  }
  root.memoizedProps = { password: "private-value" };
  const snapshot = getFiberSnapshot(root, 5000);
  assert.equal(snapshot.nodes.length, 5000);
  assert.equal(snapshot.truncated, true);
  assert.equal(getTreeRows(snapshot.nodes).length, 5000);
  assert.equal(JSON.stringify(snapshot).includes("private-value"), false);
});

test("capture protocol rejects invalid graphs, duplicate roots, and extra node payloads", () => {
  const { root } = getExample();
  const capture = {
    documentId: "document-1",
    truncated: false,
    roots: [
      {
        id: "root-1",
        rendererId: 1,
        reactVersion: "19.2.0",
        build: "development",
        ...getFiberSnapshot(root),
      },
    ],
  };
  assert.equal(getIsFiberCapture(capture), true);
  assert.equal(
    getIsFiberCapture({ ...capture, roots: [...capture.roots, ...capture.roots] }),
    false,
  );
  assert.equal(
    getIsFiberCapture({
      ...capture,
      roots: [
        {
          ...capture.roots[0],
          nodes: [{ ...capture.roots[0].nodes[0], props: { password: "secret" } }],
        },
      ],
    }),
    false,
  );
  assert.equal(
    getIsFiberCapture({
      ...capture,
      roots: [
        { ...capture.roots[0], nodes: [{ ...capture.roots[0].nodes[0], parentId: "missing" }] },
      ],
    }),
    false,
  );
  assert.equal(
    getIsInspectionMessage({
      type: "bippy:inspection",
      sequence: 1,
      capturedAt: Date.now(),
      target: "https://example.com",
      status: "live",
      frames: [{ ...capture, id: "frame-1", url: "https://example.com" }],
    }),
    true,
  );
  assert.equal(getIsInspectionMessage({ type: "bippy:inspection" }), false);
});

test("joins dispatch queues and reference props without guessing primitive provenance or calling getters", () => {
  const { root, parent, child } = getExample();
  const reference = { private: "private-state-sentinel" };
  const dispatch = () => {
    throw new Error("Must not execute dispatch");
  };
  parent.memoizedState = {
    memoizedState: reference,
    queue: { dispatch, lastRenderedReducer: () => null },
    next: null,
  };
  parent.memoizedProps = { count: 42 };
  child.memoizedProps = { options: reference, onChange: dispatch, count: 42 };
  Object.defineProperty(child.memoizedProps, "getter", {
    enumerable: true,
    get: () => {
      throw new Error("Must not execute getter");
    },
  });
  const snapshot = getFiberSnapshot(root);
  const byId = new Map(snapshot.details.map((node) => [node.id, node]));
  assert.ok(
    snapshot.edges.some(
      (edge) => edge.kind === "update" && byId.get(edge.from)?.label === "dispatch",
    ),
  );
  assert.ok(
    snapshot.edges.some(
      (edge) =>
        byId.get(edge.from)?.label === "state / reducer" &&
        byId.get(edge.to)?.label === "props.options",
    ),
  );
  assert.ok(
    snapshot.edges.some(
      (edge) =>
        byId.get(edge.from)?.label === "dispatch" && byId.get(edge.to)?.label === "props.onChange",
    ),
  );
  assert.ok(!snapshot.edges.some((edge) => byId.get(edge.to)?.label === "props.count"));
  assert.ok(!JSON.stringify(snapshot).includes("private-state-sentinel"));
  assert.equal(
    getTreeRows([...snapshot.nodes, ...snapshot.details]).length,
    snapshot.nodes.length + snapshot.details.length,
  );
});

test("context reads choose the nearest matching provider and deduplicate repeated reads", () => {
  const { root, parent, layout, child } = getExample();
  const context = createContext(null);
  parent.tag = 10;
  parent.type = context;
  parent.memoizedProps = { value: "private-outer" };
  layout.tag = 10;
  layout.type = context;
  layout.memoizedProps = { value: "private-inner" };
  Object.defineProperty(child, "dependencies", {
    value: {
      firstContext: {
        context,
        memoizedValue: "private-inner",
        next: { context, memoizedValue: "private-inner", next: null },
      },
    },
  });
  const snapshot = getFiberSnapshot(root);
  const inner = snapshot.nodes.find((node) => node.parentId === snapshot.nodes[1].id);
  const edges = snapshot.edges.filter((edge) => edge.kind === "context");
  assert.equal(edges.length, 1);
  assert.equal(snapshot.details.find((node) => node.id === edges[0].from)?.componentId, inner?.id);
  assert.deepEqual(snapshot.nodes.at(-1)?.contextProviderIds, [inner?.id]);
  assert.ok(!JSON.stringify(snapshot).includes("private-inner"));
});

test("external-store readers and subscription references are recovered without running the store", () => {
  const { root, child } = getExample();
  const getSnapshot = () => {
    throw new Error("Must not read the store");
  };
  const subscribe = () => {
    throw new Error("Must not subscribe");
  };
  child.memoizedState = {
    memoizedState: { private: "private-store" },
    queue: { value: {}, getSnapshot },
    next: { memoizedState: { deps: [subscribe] }, next: null },
  };
  const snapshot = getFiberSnapshot(root);
  assert.ok(snapshot.details.some((node) => node.label === "useSyncExternalStore"));
  assert.ok(snapshot.edges.some((edge) => edge.kind === "subscription"));
  assert.ok(!JSON.stringify(snapshot).includes("private-store"));
});
