import "../src/index.js";

import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createComponentStore } from "../src/component-store.js";
import type { StoreElement } from "../src/component-store.js";
import { createConsoleModel } from "../src/console-model.js";
import { createInspectionModel } from "../src/inspection-model.js";
import type { InspectionBackend, InspectionRecord } from "../src/inspection-model.js";
import { createTools, installFacade } from "../src/index.js";
import type { Facade, Tools } from "../src/index.js";

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

describe("version-specific inspected element behavior", () => {
  it("inspects Promise props", () => {
    const Example = ({ unusedPromise }: { unusedPromise: Promise<void> }) => {
      void unusedPromise;
      return null;
    };
    render(<Example unusedPromise={Promise.resolve()} />);
    const tree = tools.getComponentTree();
    if (!Array.isArray(tree)) throw tree.error;
    const example = tree.find((node) => node.name === "Example");
    if (!example) throw new Error("Missing Example");
    expect(tools.getComponentByUid(example.uid)).toMatchObject({
      props: { unusedPromise: {} },
    });
  });
});

const createInspectionBackend = (data: Record<string, unknown>): InspectionBackend => ({
  inspect: (uid): InspectionRecord => ({ data, revision: 1, uid }),
});

const getInspectionRecord = (data: Record<string, unknown>): InspectionRecord => {
  const result = createInspectionModel(createInspectionBackend(data)).inspect("component");
  if ("error" in result) throw result.error;
  return result;
};

describe("previously disabled upstream behavior", () => {
  it("should disable the current dispatcher before shallow rendering so no effects get scheduled", async () => {
    let effectCount = 0;
    const target = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
    const consoleModel = createConsoleModel({
      getCurrentStack: () => "\n    at Example",
      target,
    });
    const Example = ({ value }: { value: string }) => {
      useEffect(() => {
        effectCount++;
        expect(value).toBe("abc");
      }, [value]);
      consoleModel.warn("Warning to trigger appended component stacks.");
      return null;
    };

    render(<Example value="abc" />);
    await waitFor(() => expect(effectCount).toBe(1));
    expect(target.warn).toHaveBeenCalledWith(
      "Warning to trigger appended component stacks.",
      "\n    at Example",
    );
  });

  it("should inspect the currently selected element (legacy render)", () => {
    expect(
      getInspectionRecord({
        context: null,
        hooks: [{ id: 0, isStateEditable: true, name: "State", subHooks: [], value: 1 }],
        owners: null,
        props: { a: 1, b: "abc" },
        rootType: "render()",
        state: null,
      }).data,
    ).toMatchObject({
      hooks: [{ name: "State", value: 1 }],
      props: { a: 1, b: "abc" },
      rootType: "render()",
    });
  });

  it("should inspect hooks for components that only use context (legacy render)", () => {
    expect(
      getInspectionRecord({
        context: null,
        hooks: [{ id: null, isStateEditable: false, name: "Context", subHooks: [], value: true }],
        owners: null,
        props: { a: 1, b: "abc" },
        rootType: "render()",
        state: null,
      }).data.hooks,
    ).toEqual([{ id: null, isStateEditable: false, name: "Context", subHooks: [], value: true }]);
  });

  it("should not error when an unchanged component is re-inspected after component filters changed (legacy render)", () => {
    const store = createComponentStore();
    store.setElements([
      { children: [2], displayName: null, id: 1, parentId: null, type: "root" },
      { children: [], displayName: "Example", id: 2, parentId: 1, type: "function" },
    ]);
    const inspectionModel = createInspectionModel(createInspectionBackend({ props: {} }));
    expect(inspectionModel.inspect("example")).not.toHaveProperty("error");
    store.setFilters([]);
    inspectionModel.invalidate();
    expect(inspectionModel.inspect("example")).not.toHaveProperty("error");
  });

  it("should display the root type for ReactDOM.hydrate", () => {
    expect(getInspectionRecord({ rootType: "hydrate()" }).data.rootType).toBe("hydrate()");
  });

  it("should display the root type for ReactDOM.render", () => {
    expect(getInspectionRecord({ rootType: "render()" }).data.rootType).toBe("render()");
  });

  it("inspecting nested renderers should not throw (legacy render)", () => {
    const elements: StoreElement[] = [
      { children: [2], displayName: null, id: 1, parentId: null, type: "root" },
      { children: [], displayName: "App", id: 2, parentId: 1, type: "function" },
      { children: [4], displayName: null, id: 3, parentId: null, type: "root" },
      { children: [], displayName: "Group", id: 4, ownerId: 2, parentId: 3, type: "function" },
    ];
    const store = createComponentStore();
    store.setElements(elements);
    expect(store.getRoots()).toEqual([1, 3]);
    expect(store.getOwnersTree(2).map((element) => element.displayName)).toEqual(["App", "Group"]);
  });
});
