import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createTools, installFacade } from "../src/index.js";
import type { Facade, Tools } from "../src/index.js";

interface ItemProps {
  value: number;
}

interface LargeSubtreeProps {
  isVisible: boolean;
}

const itemCount = 5_000;
const values = Array.from({ length: itemCount }, (_, index) => index);
let facade: Facade;
let tools: Tools;

const Item = ({ value }: ItemProps) => <li>{value}</li>;

const LargeSubtree = ({ isVisible }: LargeSubtreeProps) => (
  <ul>
    <li>dummy item</li>
    {isVisible ? values.map((value) => <Item key={value} value={value} />) : null}
  </ul>
);

beforeEach(() => {
  facade = installFacade();
  tools = createTools(facade);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream performance regression fixture", () => {
  it("profiles mounting and unmounting a large subtree", () => {
    const rendered = render(<LargeSubtree isVisible={false} />);

    tools.startProfiling("mount-large-subtree");
    rendered.rerender(<LargeSubtree isVisible />);
    expect(tools.findComponents("Item")).toMatchObject({ totalCount: itemCount });
    expect(tools.stopProfiling()).toMatchObject({ commits: 1 });

    tools.startProfiling("unmount-large-subtree");
    rendered.rerender(<LargeSubtree isVisible={false} />);
    expect(tools.findComponents("Item")).toMatchObject({ totalCount: 0 });
    expect(tools.stopProfiling()).toMatchObject({ commits: 1 });
  });
});
