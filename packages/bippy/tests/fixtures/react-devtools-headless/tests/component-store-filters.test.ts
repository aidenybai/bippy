import { describe, expect, it, vi } from "vite-plus/test";
import { createComponentStore } from "../src/component-store.js";
import type { ComponentFilter, StoreElement } from "../src/component-store.js";

const elements: StoreElement[] = [
  { children: [2], displayName: null, id: 1, parentId: null, type: "root" },
  { children: [3, 4, 5, 6, 7], displayName: "App", id: 2, parentId: 1, type: "function" },
  { children: [], displayName: "Button", id: 3, parentId: 2, type: "function" },
  { children: [], displayName: "div", id: 4, parentId: 2, type: "host" },
  { children: [], displayName: "Suspense", id: 5, parentId: 2, type: "suspense" },
  { children: [], displayName: "Activity", id: 6, parentId: 2, type: "activity" },
  {
    children: [],
    displayName: "Memo(Panel)",
    hocDisplayNames: ["Memo"],
    id: 7,
    parentId: 2,
    type: "view-transition",
  },
];

const names = (store: ReturnType<typeof createComponentStore>): Array<string | null> =>
  store.getVisibleElements().map((element) => element.displayName);

const filter = (kind: ComponentFilter["kind"], value: string): ComponentFilter => ({
  isEnabled: true,
  kind,
  value,
});

describe("upstream Store component-filter behavior", () => {
  it("should throw if filters are updated while profiling", () => {
    const store = createComponentStore();
    store.setIsProfiling(true);
    expect(() => store.setFilters([filter("type", "host")])).toThrow("while profiling");
  });

  it("should support filtering by element type", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([filter("type", "host")]);
    expect(names(store)).not.toContain("div");
  });

  it("should filter Suspense", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([filter("type", "suspense")]);
    expect(names(store)).not.toContain("Suspense");
  });

  it("should filter Activity", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([filter("type", "activity")]);
    expect(names(store)).not.toContain("Activity");
  });

  it("should filter ViewTransition", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([filter("type", "view-transition")]);
    expect(names(store)).not.toContain("Memo(Panel)");
  });

  it("should ignore invalid ElementTypeRoot filter", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([filter("type", "root")]);
    expect(names(store)).toContain("App");
  });

  it("should filter by display name", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([filter("display-name", "button")]);
    expect(names(store)).not.toContain("Button");
  });

  it("should filter HOCs", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([filter("hoc", "Memo")]);
    expect(names(store)).not.toContain("Memo(Panel)");
  });

  it("should filter by path", () => {
    const store = createComponentStore();
    store.setElements(
      elements.map((element) => ({
        ...element,
        sourcePath: element.id === 2 ? "/src/App.tsx" : undefined,
      })),
    );
    store.setFilters([filter("location", "/src/App\\.tsx")]);
    expect(names(store)).not.toContain("App");
    store.setFilters([filter("location", "this:is:a:made:up:path")]);
    expect(names(store)).toContain("App");
  });

  it("should not send a bridge update if the set of enabled filters has not changed", () => {
    const onFiltersChanged = vi.fn();
    const store = createComponentStore({ onFiltersChanged });
    const filters = [filter("type", "host")];
    store.setFilters(filters);
    store.setFilters(filters);
    expect(onFiltersChanged).toHaveBeenCalledOnce();
  });

  it("should not break when Suspense nodes are filtered from the tree", () => {
    const store = createComponentStore();
    const nested = elements.map((element) => ({ ...element, children: [...element.children] }));
    nested[4].children = [8];
    nested.push({ children: [], displayName: "Content", id: 8, parentId: 5, type: "function" });
    store.setElements(nested);
    store.setFilters([filter("type", "suspense")]);
    expect(names(store)).toContain("Content");
  });

  it("only counts for unfiltered components (legacy render)", () => {
    const store = createComponentStore();
    store.setElements(
      elements.map((element) => ({ ...element, errorCount: element.id === 3 ? 1 : 0 })),
    );
    store.setFilters([filter("display-name", "Button")]);
    expect(
      store.getVisibleElements().reduce((count, element) => count + (element.errorCount ?? 0), 0),
    ).toBe(0);
  });

  it("only counts for unfiltered components (createRoot)", () => {
    const store = createComponentStore();
    store.setElements(
      elements.map((element) => ({ ...element, warningCount: element.id === 3 ? 1 : 0 })),
    );
    store.setFilters([filter("display-name", "Button")]);
    expect(
      store.getVisibleElements().reduce((count, element) => count + (element.warningCount ?? 0), 0),
    ).toBe(0);
  });

  it("resets forced error and fallback states when filters are changed", () => {
    const onFiltersChanged = vi.fn();
    const store = createComponentStore({ onFiltersChanged });
    store.setFilters([filter("type", "host")]);
    expect(onFiltersChanged).toHaveBeenCalledOnce();
  });

  it("can filter by Activity slices", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([filter("activity", "hidden")]);
    expect(names(store)).not.toContain("Activity");
  });

  it("ignores disabled filters", () => {
    const store = createComponentStore();
    store.setElements(elements);
    store.setFilters([{ ...filter("type", "host"), isEnabled: false }]);
    expect(names(store)).toContain("div");
  });
});
