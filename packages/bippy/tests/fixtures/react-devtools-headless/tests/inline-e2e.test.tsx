import "../src/index.js";

import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createTools, installFacade } from "../src/index.js";
import type { Facade, Tools, TreeNode } from "../src/index.js";

interface ListItemProps {
  label: string;
}

let facade: Facade;
let tools: Tools;

const ListItem = ({ label }: ListItemProps) => <li>{label}</li>;
const List = ({ items }: { items: string[] }) => (
  <ul>
    {items.map((item) => (
      <ListItem key={item} label={item} />
    ))}
  </ul>
);

const getTree = (): TreeNode[] => {
  const tree = tools.getComponentTree();
  if (!Array.isArray(tree)) throw tree.error;
  return tree;
};

const getNode = (name: string): TreeNode => {
  const node = getTree().find((candidateNode) => candidateNode.name === name);
  if (!node) throw new Error(`Missing ${name}`);
  return node;
};

beforeEach(() => {
  facade = installFacade();
  tools = createTools(facade);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream inline Components end-to-end behavior", () => {
  it("Should display initial React components", () => {
    const rendered = render(<List items={["one", "two", "three"]} />);
    expect(rendered.container.querySelectorAll("li")).toHaveLength(3);
    expect(getTree().filter((node) => node.name === "ListItem")).toHaveLength(3);
  });

  it("Should display newly added React components", () => {
    const rendered = render(<List items={["one", "two", "three"]} />);
    rendered.rerender(<List items={["one", "two", "three", "four"]} />);
    expect(getTree().filter((node) => node.name === "ListItem")).toHaveLength(4);
  });

  it("Should allow elements to be inspected", () => {
    render(<List items={["one", "two", "three"]} />);
    const listItem = getTree().find((node) => node.name === "ListItem");
    if (!listItem) throw new Error("Missing ListItem");
    expect(tools.getComponentByUid(listItem.uid)).toMatchObject({
      name: "ListItem",
      props: { label: "one" },
    });
  });

  it("Should allow inspecting source of the element", () => {
    render(<List items={["one"]} />);
    const source = tools.getComponentSource(getNode("ListItem").uid);
    if ("error" in source) throw source.error;
    expect(source.source?.fileName).toContain("inline-e2e.test.tsx");
  });

  it("should allow props to be edited", async () => {
    const rendered = render(<List items={["one"]} />);
    act(() => {
      expect(tools.overrideProps(getNode("ListItem").uid, ["label"], "new")).toEqual({
        success: true,
      });
    });
    await waitFor(() => expect(rendered.container.textContent).toBe("new"));
  });

  it("should load and parse hook names for the inspected element", () => {
    const HookList = () => {
      const [items] = React.useState(["one"]);
      const inputReference = React.useRef<HTMLInputElement>(null);
      return <input ref={inputReference} value={items[0]} readOnly />;
    };
    render(<HookList />);
    expect(tools.getComponentByUid(getNode("HookList").uid, true)).toMatchObject({
      hooks: [
        expect.objectContaining({ name: "State", value: ["one"] }),
        expect.objectContaining({ name: "Ref" }),
      ],
    });
  });

  it("should allow searching for component by name", () => {
    render(<List items={["one", "two", "three"]} />);
    expect(tools.findComponents("List")).toMatchObject({ page: 1, totalCount: 4, totalPages: 1 });
    expect(tools.findComponents("ListItem", undefined, 2, 1)).toMatchObject({
      results: [expect.objectContaining({ name: "ListItem" })],
      page: 2,
      totalCount: 3,
      totalPages: 3,
    });
  });
});

describe("upstream inline Profiler end-to-end behavior", () => {
  it("should record renders and commits when active", () => {
    const rendered = render(<List items={["one", "two", "three"]} />);
    expect(tools.startProfiling("inline")).toEqual({ status: "started", traceName: "inline" });
    rendered.rerender(<List items={["one", "two", "three", "four"]} />);
    rendered.rerender(<List items={["one", "two", "three", "four", "five"]} />);
    rendered.rerender(<List items={["one", "two", "three", "four", "five", "six"]} />);
    expect(tools.stopProfiling()).toMatchObject({ commits: 3, traceName: "inline" });
    const overview = tools.getTraceOverview("inline");
    if (!Array.isArray(overview)) throw overview.error;
    expect(overview.map((commit) => commit.commit)).toEqual([0, 1, 2]);
  });

  it("should allow searching for a component within the selected commit", () => {
    const rendered = render(<List items={["one", "two", "three"]} />);
    tools.startProfiling("search");
    rendered.rerender(<List items={["one", "two", "three", "four"]} />);
    rendered.rerender(<List items={["one", "two", "three", "four", "five"]} />);
    rendered.rerender(<List items={["one", "two", "three", "four", "five", "six"]} />);
    tools.stopProfiling();
    const listItemCounts = [0, 1, 2].map((commitIndex) => {
      const report = tools.getCommitReport("search", commitIndex);
      if ("error" in report) throw report.error;
      return report.components.filter((component) => component.name === "ListItem").length;
    });
    expect(listItemCounts).toEqual([4, 5, 6]);
  });
});
