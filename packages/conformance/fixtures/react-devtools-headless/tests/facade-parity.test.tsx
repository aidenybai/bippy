import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { createTools } from "../src/index.js";
import type { Facade, Tools, TreeNode } from "../src/types.js";

let facade: Facade;
let tools: Tools;

beforeEach(() => {
  facade = installFacade();
  tools = createTools(facade);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

const getTree = (): TreeNode[] => {
  const tree = tools.getComponentTree();
  if (!Array.isArray(tree)) throw new Error(String(tree.error));
  return tree;
};

const getNode = (name: string): TreeNode => {
  const node = getTree().find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing ${name}`);
  return node;
};

describe("remaining upstream facade conformance", () => {
  it("returns empty search results when no components match", () => {
    render(<div />);
    expect(tools.findComponents("Missing")).toMatchObject({ results: [], totalCount: 0 });
  });

  it("clamps search pages to valid ranges", () => {
    const Item = () => null;
    render(
      <>
        {Array.from({ length: 12 }, (_, index) => (
          <Item key={index} />
        ))}
      </>,
    );
    expect(tools.findComponents("Item", undefined, 100, 5)).toMatchObject({
      page: 3,
      totalPages: 3,
    });
  });

  it("matches host tags and wrapped Memo names", () => {
    const Inner = () => <button />;
    const Memo = React.memo(Inner);
    render(<Memo />);
    expect(tools.findComponents("button")).toMatchObject({ totalCount: 1 });
    expect(tools.findComponents("Inner")).toMatchObject({ totalCount: 1 });
  });

  it("does not match unnamed internal nodes", () => {
    render(
      <>
        <span />
      </>,
    );
    expect(tools.findComponents("null")).toMatchObject({ totalCount: 0 });
  });

  it("returns an empty hook list for hookless function components", () => {
    const Hookless = () => null;
    render(<Hookless />);
    expect(tools.getComponentByUid(getNode("Hookless").uid, true)).toMatchObject({ hooks: [] });
  });

  it("serializes symbols, undefined, circular values, and deep props", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const App = (_props: Record<string, unknown>) => null;
    render(
      <App
        symbol={Symbol("value")}
        missing={undefined}
        circular={circular}
        deep={{ a: { b: { c: 1 } } }}
      />,
    );
    expect(tools.getComponentByUid(getNode("App").uid)).toMatchObject({
      props: { circular: { self: "[circular]" }, missing: null, symbol: "[symbol]" },
    });
  });

  it("returns empty structural and owner stacks for the root", () => {
    render(<div />);
    const root = getTree().find((node) => node.type === "root");
    if (!root) throw new Error("Missing root");
    expect(tools.getParentStack(root.uid)).toEqual([]);
    expect(tools.getOwnerStack(root.uid)).toEqual([]);
  });

  it("auto-generates profiler trace names", () => {
    expect(tools.startProfiling()).toMatchObject({
      status: "started",
      traceName: expect.any(String),
    });
    expect(tools.stopProfiling()).toMatchObject({ status: "stopped" });
  });

  it("rejects duplicate profiler starts and inactive stops", () => {
    tools.startProfiling("trace");
    expect(tools.startProfiling("other")).toEqual({ error: 'Already profiling trace "trace"' });
    tools.stopProfiling();
    expect(tools.stopProfiling()).toEqual({ error: "Not currently profiling" });
  });

  it("returns an empty overview for traces without commits", () => {
    tools.startProfiling("empty");
    tools.stopProfiling();
    expect(tools.getTraceOverview("empty")).toEqual([]);
  });

  it("returns errors for unknown traces and commit indexes", () => {
    expect(tools.getTraceOverview("missing")).toEqual({ error: 'Unknown trace "missing"' });
    tools.startProfiling("trace");
    render(<div />);
    tools.stopProfiling();
    expect(tools.getCommitReport("trace", 99)).toEqual({ error: "Commit index out of range" });
  });

  it("records independent profiler traces", () => {
    const App = ({ value }: { value: number }) => <div>{value}</div>;
    tools.startProfiling("first");
    const view = render(<App value={1} />);
    tools.stopProfiling();
    tools.startProfiling("second");
    view.rerender(<App value={2} />);
    tools.stopProfiling();
    expect(tools.getTraceOverview("first")).toHaveLength(1);
    expect(tools.getTraceOverview("second")).toHaveLength(1);
  });

  it("does not record post-commit events while profiling is inactive", () => {
    render(<div />);
    expect(facade.profilingState.traces.size).toBe(0);
  });
});
