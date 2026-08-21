import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Fiber } from "bippy";
import { installFacade } from "../src/facade.js";
import { createSuspenseTools } from "../src/suspense-tools.js";
import { createTreeTools } from "../src/tree-tools.js";
import type { Facade, SuspenseTools, TreeTools } from "../src/types.js";

let facade: Facade;
let treeTools: TreeTools;

beforeEach(() => {
  facade = installFacade();
  treeTools = createTreeTools(facade.fiberRoots, facade.target);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

const createTestSuspenseTools = (
  setFiberSuspense: (fiber: Fiber, shouldSuspend: boolean) => boolean,
): SuspenseTools =>
  createSuspenseTools(
    facade.fiberRoots,
    treeTools.getFiberByUid,
    treeTools.getUid,
    setFiberSuspense,
  );

describe("suspense tree collection", () => {
  it("measures each Suspense boundary once per tree build", () => {
    const App = () => (
      <React.Suspense fallback={<div>loading</div>}>
        <span>ready</span>
      </React.Suspense>
    );
    render(<App />);
    const suspenseTools = createTestSuspenseTools(() => true);
    const getClientRects = vi.spyOn(Element.prototype, "getClientRects");

    expect(suspenseTools.getSuspenseTree()).toHaveLength(1);
    expect(getClientRects).toHaveBeenCalledTimes(1);

    getClientRects.mockRestore();
  });
});

describe("suspense milestone consistency", () => {
  it("records only the overrides that the renderer applied", () => {
    const App = () => (
      <React.Suspense fallback={<div>outer</div>}>
        <React.Suspense fallback={<div>inner</div>}>
          <span>ready</span>
        </React.Suspense>
      </React.Suspense>
    );
    render(<App />);
    const appliedOverrides: Array<{ shouldSuspend: boolean; uid: string }> = [];
    let rejectedUid = "";
    const suspenseTools = createTestSuspenseTools((fiber, shouldSuspend) => {
      const uid = treeTools.getUid(fiber);
      if (uid === rejectedUid) return false;
      appliedOverrides.push({ shouldSuspend, uid });
      return true;
    });
    const [outerUid, innerUid] = suspenseTools.getSuspenseTree().map((node) => node.uid);
    rejectedUid = innerUid;

    expect(suspenseTools.setSuspenseMilestone([outerUid, innerUid])).toEqual({
      error: "Renderer does not support Suspense overrides",
    });
    expect(suspenseTools.setSuspenseMilestone([])).toEqual({ success: true });
    expect(appliedOverrides).toEqual([
      { shouldSuspend: true, uid: outerUid },
      { shouldSuspend: false, uid: outerUid },
    ]);
  });

  it("stops tracking boundaries whose fibers are gone", () => {
    const App = ({ hasBoundary }: { hasBoundary: boolean }) =>
      hasBoundary ? (
        <React.Suspense fallback={<div>loading</div>}>
          <span>ready</span>
        </React.Suspense>
      ) : null;
    const view = render(<App hasBoundary={true} />);
    const appliedOverrides: string[] = [];
    const suspenseTools = createTestSuspenseTools((fiber) => {
      appliedOverrides.push(treeTools.getUid(fiber));
      return true;
    });
    const [boundaryUid] = suspenseTools.getSuspenseTree().map((node) => node.uid);

    expect(suspenseTools.setSuspenseMilestone([boundaryUid])).toEqual({ success: true });
    view.rerender(<App hasBoundary={false} />);
    expect(suspenseTools.setSuspenseMilestone([])).toEqual({ success: true });
    expect(appliedOverrides).toEqual([boundaryUid]);
  });
});
