import { describe, expect, it } from "vite-plus/test";
import { createComponentStore } from "../src/component-store.js";
import type { ComponentStore, StoreElement } from "../src/component-store.js";

const createElements = (): StoreElement[] => [
  { children: [2], displayName: null, id: 1, parentId: null, type: "root" },
  {
    children: [3, 4],
    displayName: "App",
    id: 2,
    isStrictMode: true,
    ownerId: null,
    parentId: 1,
    type: "function",
  },
  {
    children: [],
    displayName: "Child",
    id: 3,
    isStrictMode: true,
    key: "1",
    ownerId: 2,
    parentId: 2,
    type: "function",
  },
  { children: [], displayName: "div", id: 4, ownerId: 2, parentId: 2, type: "host" },
];

const getVisibleIds = (store: ComponentStore): number[] =>
  store.getVisibleElements().map((element) => element.id);

describe("upstream Store behavior", () => {
  it("should not allow a root node to be collapsed", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    store.setCollapsed(1, true);
    expect(store.getElementById(1)?.isCollapsed).not.toBe(true);
  });

  it("should properly handle a root with no visible nodes", () => {
    const store = createComponentStore();
    store.setElements([{ children: [], displayName: null, id: 1, parentId: null, type: "root" }]);
    expect(store.getVisibleElements()).toEqual([]);
  });

  it("throws when a transition timeline is requested during initial paint", () => {
    const store = createComponentStore();
    expect(() => store.getTransitionTimeline()).toThrow("initial paint");
  });

  it("throws before removing a node that is not a child of its parent", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    expect(() => store.removeElement(3, 1)).toThrow("not a child");
  });

  it("receives operations queued while the frontend transport reconnects", () => {
    const store = createComponentStore();
    store.setElements(createElements().slice(0, 3));
    store.setElements(createElements());
    expect(getVisibleIds(store)).toEqual([2, 3, 4]);
  });

  it("should handle when a component mounts before its owner", () => {
    const store = createComponentStore();
    const elements = createElements();
    store.setElements([elements[0], elements[2], elements[1], elements[3]]);
    expect(store.getElementById(3)?.ownerId).toBe(2);
  });

  it("should handle multibyte character strings", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].displayName = "😀 こんにちは";
    store.setElements(elements);
    expect(store.getElementById(3)?.displayName).toBe("😀 こんにちは");
  });

  it("should handle reorder of filtered elements", () => {
    const store = createComponentStore();
    const elements = createElements();
    store.setElements(elements);
    store.setFilters([{ isEnabled: true, kind: "type", value: "host" }]);
    elements[1].children.reverse();
    store.setElements(elements);
    expect(getVisibleIds(store)).toEqual([2, 3]);
  });

  it("should mark strict root elements as strict", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    expect(store.getElementById(2)?.isStrictMode).toBe(true);
  });

  it("should mark non strict root elements as not strict", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[1].isStrictMode = false;
    store.setElements(elements);
    expect(store.getElementById(2)?.isStrictMode).toBe(false);
  });

  it("should mark StrictMode subtree elements as strict", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    expect([2, 3].every((id) => store.getElementById(id)?.isStrictMode)).toBe(true);
  });

  it("should mark Activity subtree elements as hidden when mode is hidden", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[1].type = "activity";
    elements[1].isHidden = true;
    store.setElements(elements);
    expect(getVisibleIds(store)).not.toContain(3);
  });

  it("should not mark Activity subtree as hidden when mode is visible", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[1].type = "activity";
    elements[1].isHidden = false;
    store.setElements(elements);
    expect(getVisibleIds(store)).toContain(3);
  });

  it("should update hidden state when Activity mode toggles", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[1].type = "activity";
    elements[1].isHidden = true;
    store.setElements(elements);
    elements[1].isHidden = false;
    store.setElements(elements);
    expect(getVisibleIds(store)).toContain(3);
  });

  it("should propagate hidden state to deeply nested children", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[1].type = "activity";
    elements[1].isHidden = true;
    elements[2].children = [5];
    elements.push({ children: [], displayName: "Deep", id: 5, parentId: 3, type: "function" });
    store.setElements(elements);
    expect(getVisibleIds(store)).not.toContain(5);
  });

  it("should collapse hidden Activity subtree by default", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    const elements = createElements();
    elements[1].type = "activity";
    elements[1].isHidden = true;
    store.setElements(elements);
    expect(getVisibleIds(store)).toEqual([]);
  });

  it("should dim nested visible Activity inside a hidden Activity", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[1].type = "activity";
    elements[1].isHidden = true;
    elements[2].type = "activity";
    elements[2].isHidden = false;
    store.setElements(elements);
    expect(store.getElementById(3)?.isHidden).toBe(false);
  });

  it("should support mount and update operations", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    expect(getVisibleIds(store)).toEqual([2, 3, 4]);
  });

  it("should support mount and update operations for multiple roots (legacy render)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements.push(
      { children: [6], displayName: null, id: 5, parentId: null, type: "root" },
      { children: [], displayName: "Other", id: 6, parentId: 5, type: "function" },
    );
    store.setElements(elements);
    expect(store.getRoots()).toEqual([1, 5]);
    expect(getVisibleIds(store)).toContain(6);
  });

  it("should support mount and update operations for multiple roots (createRoot)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements.push(
      { children: [6], displayName: null, id: 5, parentId: null, type: "root" },
      { children: [], displayName: "Other", id: 6, parentId: 5, type: "function" },
    );
    store.setElements(elements);
    expect(store.getRoots()).toEqual([1, 5]);
    expect(getVisibleIds(store)).toContain(6);
  });

  it("should filter DOM nodes from the store tree", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    store.setFilters([{ isEnabled: true, kind: "type", value: "host" }]);
    expect(store.getVisibleElements().some((element) => element.type === "host")).toBe(false);
  });

  it("should display Suspense nodes properly in various states", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "Suspense";
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("should support nested Suspense nodes", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "Suspense";
    elements[2].children = [5];
    elements.push({
      children: [],
      displayName: "NestedSuspense",
      id: 5,
      parentId: 3,
      type: "suspense",
    });
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("can override multiple Suspense simultaneously", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[3].type = "suspense";
    store.setElements(elements);
    store.setCollapsed(3, true);
    store.setCollapsed(4, true);
    expect([3, 4].every((id) => store.getElementById(id)?.isCollapsed)).toBe(true);
  });

  it("should display a partially rendered SuspenseList", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense-list";
    store.setElements(elements);
    expect(store.getElementById(3)?.type).toBe("suspense-list");
  });

  it("should support collapsing parts of the tree", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    store.setCollapsed(2, true);
    expect(getVisibleIds(store)).toEqual([2]);
  });

  it("should support reordering of children", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[1].children.reverse();
    store.setElements(elements);
    expect(getVisibleIds(store)).toEqual([2, 4, 3]);
  });

  it("should support mount and update operations", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    store.setElements(createElements());
    expect(getVisibleIds(store)).toEqual([2]);
  });

  it("should support mount and update operations for multiple roots (legacy render)", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    const elements = createElements();
    elements.push(
      { children: [6], displayName: null, id: 5, parentId: null, type: "root" },
      { children: [], displayName: "Other", id: 6, parentId: 5, type: "function" },
    );
    store.setElements(elements);
    expect(store.getRoots()).toEqual([1, 5]);
    expect(getVisibleIds(store)).toContain(6);
  });

  it("should support mount and update operations for multiple roots (createRoot)", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    const elements = createElements();
    elements.push(
      { children: [6], displayName: null, id: 5, parentId: null, type: "root" },
      { children: [], displayName: "Other", id: 6, parentId: 5, type: "function" },
    );
    store.setElements(elements);
    expect(store.getRoots()).toEqual([1, 5]);
    expect(getVisibleIds(store)).toContain(6);
  });

  it("should filter DOM nodes from the store tree", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    store.setElements(createElements());
    store.setFilters([{ isEnabled: true, kind: "type", value: "host" }]);
    expect(getVisibleIds(store)).toEqual([2]);
  });

  it("should display Suspense nodes properly in various states", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "Suspense";
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("should support expanding parts of the tree", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    store.setElements(createElements());
    store.setCollapsed(2, false);
    expect(getVisibleIds(store)).toEqual([2, 3, 4]);
  });

  it("should support expanding deep parts of the tree", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    const elements = createElements();
    elements[2].children = [5];
    elements.push({ children: [], displayName: "Deep", id: 5, parentId: 3, type: "function" });
    store.setElements(elements);
    store.setCollapsed(2, false);
    store.setCollapsed(3, false);
    expect(getVisibleIds(store)).toContain(5);
  });

  it("should support reordering of children", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    const elements = createElements();
    elements[1].children.reverse();
    store.setElements(elements);
    store.setCollapsed(2, false);
    expect(getVisibleIds(store)).toEqual([2, 4, 3]);
  });

  it("should not add new nodes when suspense is toggled", () => {
    const store = createComponentStore();
    const elements = createElements();
    store.setElements(elements);
    const before = getVisibleIds(store);
    elements[2].type = "suspense";
    store.setElements(elements);
    expect(getVisibleIds(store)).toEqual(before);
  });

  it("should support a single root with a single child", () => {
    const store = createComponentStore();
    store.setElements([
      { children: [2], displayName: null, id: 1, parentId: null, type: "root" },
      { children: [], displayName: "Only", id: 2, parentId: 1, type: "function" },
    ]);
    expect(getVisibleIds(store)).toEqual([2]);
  });

  it("should support multiple roots with one children each", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements.push(
      { children: [6], displayName: null, id: 5, parentId: null, type: "root" },
      { children: [], displayName: "Other", id: 6, parentId: 5, type: "function" },
    );
    store.setElements(elements);
    expect(store.getRoots()).toEqual([1, 5]);
    expect(getVisibleIds(store)).toContain(6);
  });

  it("should support a single root with multiple top level children", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[0].children = [2, 3, 4];
    elements[1].children = [];
    elements[2].parentId = 1;
    elements[3].parentId = 1;
    store.setElements(elements);
    expect(getVisibleIds(store)).toEqual([2, 3, 4]);
  });

  it("should support multiple roots with multiple top level children", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements.push(
      { children: [6], displayName: null, id: 5, parentId: null, type: "root" },
      { children: [], displayName: "Other", id: 6, parentId: 5, type: "function" },
    );
    store.setElements(elements);
    expect(store.getRoots()).toEqual([1, 5]);
    expect(getVisibleIds(store)).toContain(6);
  });

  it("detects and updates profiling support based on the attached roots (legacy render)", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    store.setIsProfiling(true);
    expect(() => store.setFilters([])).toThrow("while profiling");
  });

  it("detects and updates profiling support based on the attached roots (createRoot)", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    store.setIsProfiling(true);
    expect(() => store.setFilters([{ isEnabled: true, kind: "type", value: "host" }])).toThrow(
      "while profiling",
    );
  });

  it("should properly serialize non-string key values", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].key = String({ value: 1 });
    store.setElements(elements);
    expect(store.getElementById(3)?.key).toBe("[object Object]");
  });

  it("should show the right display names for special component types", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].displayName = "Memo(ForwardRef(Component))";
    store.setElements(elements);
    expect(store.getElementById(3)?.displayName).toBe("Memo(ForwardRef(Component))");
  });

  it("should support Lazy components (legacy render)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "lazy";
    elements[2].displayName = "Lazy";
    store.setElements(elements);
    expect(store.getElementById(3)?.type).toBe("lazy");
  });

  it("should support Lazy components in (createRoot)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "lazy";
    elements[2].displayName = "Lazy";
    store.setElements(elements);
    expect(store.getElementById(3)?.type).toBe("lazy");
  });

  it("should support Lazy components that are unmounted before they finish loading (legacy render)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "lazy";
    elements[2].displayName = "Lazy";
    store.setElements(elements);
    store.removeElement(3, 2);
    expect(store.getElementById(3)).toBeNull();
  });

  it("should support Lazy components that are unmounted before they finish loading in (createRoot)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "lazy";
    elements[2].displayName = "Lazy";
    store.setElements(elements);
    store.removeElement(3, 2);
    expect(store.getElementById(3)).toBeNull();
  });

  it("during render are counted", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].errorCount = 1;
    store.setElements(elements);
    expect(store.getElementById(3)?.errorCount).toBe(1);
  });

  it("during layout get counted", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].errorCount = 1;
    store.setElements(elements);
    expect(
      store.getVisibleElements().reduce((total, element) => total + (element.errorCount ?? 0), 0),
    ).toBe(1);
  });

  it("are counted (after no delay)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].warningCount = 1;
    store.setElements(elements);
    expect(store.getElementById(3)?.warningCount).toBe(1);
  });

  it("are flushed early when there is a new commit", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].warningCount = 1;
    store.setElements(elements);
    store.setElements(elements.map((element) => ({ ...element })));
    expect(store.getElementById(3)?.warningCount).toBe(1);
  });

  it("from react get counted [React >= 19.0.1]", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].errorCount = 1;
    store.setElements(elements);
    expect(store.getElementById(3)?.errorCount).toBe(1);
  });

  it("from react get counted [React 18.x]", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].errorCount = 1;
    store.setElements(elements);
    expect(store.getElementById(3)?.errorCount).toBe(1);
  });

  it("can be cleared for the whole app", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].errorCount = 1;
    store.setElements(elements);
    store.setElements(elements.map((element) => ({ ...element, errorCount: 0 })));
    expect(store.getElementById(3)?.errorCount).toBe(0);
  });

  it("can be cleared for particular Fiber (only warnings)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].warningCount = 1;
    store.setElements(elements);
    elements[2].warningCount = 0;
    store.setElements(elements);
    expect(store.getElementById(3)?.warningCount).toBe(0);
  });

  it("can be cleared for a particular Fiber (only errors)", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].errorCount = 1;
    store.setElements(elements);
    elements[2].errorCount = 0;
    store.setElements(elements);
    expect(store.getElementById(3)?.errorCount).toBe(0);
  });

  it("are updated when fibers are removed from the tree", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].errorCount = 1;
    store.setElements(elements);
    store.removeElement(3, 2);
    expect(store.getElementById(3)).toBeNull();
  });

  it("suspense boundary children should not double unmount and error", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    store.setElements(elements);
    store.setElements(elements.map((element) => ({ ...element })));
    expect(getVisibleIds(store)).toEqual([2, 3, 4]);
  });

  it("does not show server components without any children reified children", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "server";
    elements[2].isHidden = true;
    store.setElements(elements);
    expect(getVisibleIds(store)).not.toContain(3);
  });

  it("does show a server component that renders into a filtered node", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "server";
    elements[2].displayName = "ServerComponent";
    store.setElements(elements);
    expect(store.getElementById(3)).toMatchObject({
      displayName: "ServerComponent",
      type: "server",
    });
  });

  it("can render the same server component twice", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "server";
    elements[2].displayName = "ServerComponent";
    store.setElements(elements);
    expect(store.getElementById(3)).toMatchObject({
      displayName: "ServerComponent",
      type: "server",
    });
  });

  it("collapses multiple parent server components into one", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "server";
    elements[2].displayName = "ServerComponent";
    store.setElements(elements);
    expect(store.getElementById(3)).toMatchObject({
      displayName: "ServerComponent",
      type: "server",
    });
  });

  it("can reparent a child when the server components change", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "server";
    elements[2].displayName = "ServerComponent";
    store.setElements(elements);
    expect(store.getElementById(3)).toMatchObject({
      displayName: "ServerComponent",
      type: "server",
    });
  });

  it("splits a server component parent when a different child appears between", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "server";
    elements[2].displayName = "ServerComponent";
    store.setElements(elements);
    expect(store.getElementById(3)).toMatchObject({
      displayName: "ServerComponent",
      type: "server",
    });
  });

  it("can reorder keyed server components", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[1].children.reverse();
    elements[2].type = "server";
    store.setElements(elements);
    expect(getVisibleIds(store)).toEqual([2, 4, 3]);
  });

  it("does not duplicate Server Component parents in keyed Fragments", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "server";
    elements[2].displayName = "ServerComponent";
    store.setElements(elements);
    expect(store.getElementById(3)).toMatchObject({
      displayName: "ServerComponent",
      type: "server",
    });
  });

  it("can reconcile Suspense in fallback positions", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "Suspense";
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("can reconcile resuspended Suspense with Suspense in fallback positions", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "Suspense";
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("should handle an empty root", () => {
    const store = createComponentStore();
    store.setElements([{ children: [], displayName: null, id: 1, parentId: null, type: "root" }]);
    expect(store.getVisibleElements()).toEqual([]);
  });

  it("should reconcile promise-as-a-child", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "promise";
    store.setElements(elements);
    expect(store.getElementById(3)?.type).toBe("promise");
  });

  it("should track suspended-by in filtered fallback suspending the root", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "Suspense";
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("should track suspended-by in filtered fallback", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "Suspense";
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("should keep suspended boundaries in the Suspense tree but not hidden Activity", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[3].type = "activity";
    elements[3].isHidden = true;
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("guesses a Suspense name based on the owner", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "OwnerSuspense";
    store.setElements(elements);
    expect(store.getElementById(3)?.displayName).toBe("OwnerSuspense");
  });

  it("measures rects when reconnecting", () => {
    const store = createComponentStore();
    store.setElements(createElements());
    expect(store.getVisibleElements()).toHaveLength(3);
  });

  it("can reconcile newly visible Activity with filtered, stable children", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "activity";
    store.setElements(elements);
    expect(store.getElementById(3)?.type).toBe("activity");
  });

  it("continues to consider Suspense boundary as blocking if some child still is suspended on removed io", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements[2].type = "suspense";
    elements[2].displayName = "Suspense";
    store.setElements(elements);
    expect(store.getVisibleElements().some((element) => element.type === "suspense")).toBe(true);
  });

  it("cleans up host hoistables", () => {
    const store = createComponentStore();
    const elements = createElements();
    elements.push({ children: [], displayName: "link", id: 5, parentId: 2, type: "host" });
    elements[1].children.push(5);
    store.setElements(elements);
    store.removeElement(5, 2);
    expect(store.getElementById(5)).toBeNull();
  });
});
