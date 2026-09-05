import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { createTools } from "../src/index.js";
import type { Facade, Tools } from "../src/types.js";

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

const getNames = (): string[] => {
  const tree = tools.getComponentTree();
  if (!Array.isArray(tree)) throw new Error(String(tree.error));
  return tree.map((node) => node.name);
};

describe("upstream Fast Refresh integration behavior", () => {
  it("should not break the DevTools store", () => {
    const App = ({ value }: { value: string }) => <div>{value}</div>;
    const view = render(<App value="before" />);
    view.rerender(<App value="after" />);
    expect(getNames()).toContain("App");
  });

  it("should not break when there are warnings in between patching (before post commit hook)", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const App = ({ value }: { value: string }) => <div>{value}</div>;
    const view = render(<App value="before" />);
    console.warn("refresh warning");
    view.rerender(<App value="after" />);
    expect(getNames()).toContain("App");
    warning.mockRestore();
  });

  it("should not break when there are warnings in between patching (with post commit hook)", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const App = ({ value }: { value: string }) => <span>{value}</span>;
    const view = render(<App value="before" />);
    view.rerender(<App value="middle" />);
    console.warn("refresh warning");
    view.rerender(<App value="after" />);
    expect(getNames()).toEqual(expect.arrayContaining(["App", "span"]));
    warning.mockRestore();
  });
});
