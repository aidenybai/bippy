import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import { traverseFiber } from "bippy";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { getFiberTypeName } from "../src/fiber-metadata.js";
import { getFiberSuspenseInfo } from "../src/fiber-suspense.js";
import type { Fiber, ReactDebugInfo } from "bippy";
import type { Facade } from "../src/types.js";

let facade: Facade;

const getRootFiber = (): Fiber => {
  const root = facade.fiberRoots.values().next().value?.values().next().value;
  if (!root) throw new Error("Missing root");
  return root.current;
};

const getBoundary = (): Fiber => {
  const boundary = traverseFiber(getRootFiber(), (fiber) => getFiberTypeName(fiber) === "suspense");
  if (!boundary) throw new Error("Missing Suspense boundary");
  return boundary;
};

beforeEach(() => {
  facade = installFacade();
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream Suspense diagnostics", () => {
  it("rejects non-Suspense Fibers", () => {
    const App = () => <div />;
    render(<App />);
    expect(getFiberSuspenseInfo(getRootFiber())).toBeNull();
  });

  it("collects boundary, lazy, and use thenable debug metadata without duplicates", () => {
    const App = () => (
      <Suspense fallback={<div>loading</div>}>
        <span>ready</span>
      </Suspense>
    );
    render(<App />);
    const boundary = getBoundary();
    const sourceFiber = boundary.child?.child ?? boundary;
    const boundaryInfo: ReactDebugInfo = {
      awaited: { end: 2, env: "Server", name: "boundary", start: 1 },
    };
    const thenableInfo: ReactDebugInfo = {
      awaited: { end: 4, name: "use", start: 3 },
    };
    const invalidInfo: ReactDebugInfo = {
      awaited: { end: 0, name: "invalid", start: 0 },
    };
    if (!invalidInfo.awaited) throw new Error("Missing async info");
    Reflect.set(invalidInfo.awaited, "end", "invalid");
    boundary._debugInfo = [boundaryInfo, invalidInfo];
    Reflect.set(boundary, "elementType", { _debugInfo: [boundaryInfo] });
    const thenable = { _debugInfo: [thenableInfo] };
    Reflect.set(sourceFiber, "dependencies", { _debugThenableState: { thenables: [thenable] } });

    const info = getFiberSuspenseInfo(boundary);
    expect(info?.environments).toEqual(["Server"]);
    expect(info?.range).toEqual([1, 4]);
    expect(info?.suspendedBy.map(({ ioInfo }) => ioInfo.name)).toEqual(["boundary", "use"]);
  });

  it("does not attribute nested boundary dependencies to an ancestor", () => {
    const App = () => (
      <Suspense fallback={<div>outer</div>}>
        <span>outer content</span>
        <Suspense fallback={<div>inner</div>}>
          <span>inner content</span>
        </Suspense>
      </Suspense>
    );
    render(<App />);
    const boundaries: Fiber[] = [];
    traverseFiber(getRootFiber(), (fiber) => {
      if (getFiberTypeName(fiber) === "suspense") boundaries.push(fiber);
    });
    const innerSource = boundaries[1]?.child?.child;
    if (!innerSource) throw new Error("Missing inner source");
    innerSource._debugInfo = [{ awaited: { end: 2, name: "inner", start: 1 } }];

    expect(
      getFiberSuspenseInfo(boundaries[0])?.suspendedBy.map(({ ioInfo }) => ioInfo.name),
    ).toEqual([]);
    expect(
      getFiberSuspenseInfo(boundaries[1])?.suspendedBy.map(({ ioInfo }) => ioInfo.name),
    ).toEqual(["inner"]);
  });

  it("measures host rectangles and retains the last known geometry", () => {
    const App = () => (
      <Suspense fallback={<div>loading</div>}>
        <div>ready</div>
      </Suspense>
    );
    render(<App />);
    const boundary = getBoundary();
    const hostFiber = traverseFiber(boundary, (fiber) => getFiberTypeName(fiber) === "host");
    if (!hostFiber?.stateNode) throw new Error("Missing host instance");
    Reflect.set(hostFiber.stateNode, "getClientRects", () => [
      { height: 40, width: 30, x: 10, y: 20 },
      { height: 0, width: 0, x: "invalid", y: 0 },
    ]);

    expect(getFiberSuspenseInfo(boundary)?.rects).toEqual([
      { height: 40, width: 30, x: 10, y: 20 },
    ]);
    Reflect.set(hostFiber.stateNode, "getClientRects", () => []);
    expect(getFiberSuspenseInfo(boundary)?.rects).toEqual([
      { height: 40, width: 30, x: 10, y: 20 },
    ]);
  });

  it("measures direct text content with a document range", () => {
    const App = () => <Suspense fallback="loading">ready</Suspense>;
    render(<App />);
    const boundary = getBoundary();
    const selectNodeContents = vi.fn();
    const previousCreateRange = Reflect.get(document, "createRange");
    Reflect.set(document, "createRange", () => ({
      getClientRects: () => [{ height: 4, width: 3, x: 1, y: 2 }],
      selectNodeContents,
    }));

    expect(getFiberSuspenseInfo(boundary)?.rects).toEqual([{ height: 4, width: 3, x: 1, y: 2 }]);
    expect(selectNodeContents).toHaveBeenCalledOnce();
    Reflect.set(document, "createRange", previousCreateRange);
  });

  it("reports fallback and unknown retry-cache states", () => {
    const App = () => <Suspense fallback="loading">ready</Suspense>;
    render(<App />);
    const boundary = getBoundary();
    boundary._debugInfo = [];
    Reflect.set(boundary, "memoizedState", {});
    Reflect.set(boundary, "stateNode", new Set());

    expect(getFiberSuspenseInfo(boundary)).toMatchObject({
      isSuspended: true,
      range: null,
      unknownSuspenders: true,
    });
  });
});
