import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { createTools } from "../src/index.js";
import { getOwnersList } from "../src/owners-list.js";
import type { Facade, Tools, TreeNode } from "../src/types.js";

let facade: Facade;
let tools: Tools;

const getNode = (name: string, occurrence = 0): TreeNode => {
  const tree = tools.getComponentTree();
  if (!Array.isArray(tree)) throw new Error(String(tree.error));
  const matches = tree.filter((node) => node.name === name);
  const node = matches[occurrence];
  if (!node)
    throw new Error(`Missing ${name}: ${tree.map((candidate) => candidate.name).join(", ")}`);
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

describe("upstream owners-list UI behavior", () => {
  it("should fetch the owners list for the selected element", () => {
    const Child = () => null;
    const Parent = () => (
      <>
        <Child />
        <Child />
      </>
    );
    const Grandparent = () => <Parent />;
    render(<Grandparent />);
    const parent = getNode("Parent");
    const child = getNode("Child");
    expect(getOwnersList(tools, parent.uid)).toEqual([
      expect.objectContaining({ name: "Grandparent" }),
      expect.objectContaining({ name: "Parent" }),
    ]);
    expect(getOwnersList(tools, child.uid)).toEqual([
      expect.objectContaining({ name: "Grandparent" }),
      expect.objectContaining({ name: "Parent" }),
      expect.objectContaining({ name: "Child" }),
    ]);
  });

  it("should fetch the owners list for the selected element that includes filtered components", () => {
    const Child = () => null;
    const Parent = () => <Child />;
    const Grandparent = () => <Parent />;
    render(<Grandparent />);
    expect(
      getOwnersList(tools, getNode("Child").uid, {
        isVisible: (owner) => owner.name !== "Parent",
      }),
    ).toEqual([
      expect.objectContaining({ name: "Grandparent" }),
      expect.objectContaining({ name: "Child" }),
    ]);
  });

  it("should include the current element even if there are no other owners", () => {
    const Grandparent = () => null;
    render(<Grandparent />);
    expect(getOwnersList(tools, getNode("Grandparent").uid)).toEqual([
      expect.objectContaining({ name: "Grandparent" }),
    ]);
  });

  it("should include all owners for a component wrapped in react memo", () => {
    const InnerComponent = (_props: object, _reference: React.ForwardedRef<HTMLDivElement>) => (
      <div />
    );
    const Wrapped = React.memo(React.forwardRef(InnerComponent));
    const Grandparent = () => <Wrapped />;
    render(<Grandparent />);
    const forwardRefNode = getNode("ForwardRef(InnerComponent)");
    expect(getOwnersList(tools, forwardRefNode.uid)).toEqual([
      expect.objectContaining({ name: "Grandparent" }),
      expect.objectContaining({ name: "InnerComponent" }),
      expect.objectContaining({ name: "InnerComponent" }),
    ]);
  });
});
