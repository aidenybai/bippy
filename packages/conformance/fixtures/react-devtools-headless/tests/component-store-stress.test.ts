import { describe, expect, it } from "vite-plus/test";
import { createComponentStore } from "../src/component-store.js";
import type { StoreElement } from "../src/component-store.js";

const createElements = (count: number, isReversed = false): StoreElement[] => {
  const childIds = Array.from({ length: count }, (_, index) => index + 2);
  if (isReversed) childIds.reverse();
  return [
    { children: childIds, displayName: null, id: 1, parentId: null, type: "root" },
    ...childIds.map((id) => ({
      children: [],
      displayName: `Item${id}`,
      id,
      key: String(id),
      parentId: 1,
      type: "function",
    })),
  ];
};

const runDifferentOperations = (): void => {
  const store = createComponentStore();
  for (let count = 1; count <= 500; count += 17) store.setElements(createElements(count));
  expect(store.getVisibleElements()).toHaveLength(494);
};

const runReordering = (): void => {
  const store = createComponentStore();
  store.setElements(createElements(500));
  store.setElements(createElements(500, true));
  expect(store.getElementAtIndex(0)?.id).toBe(501);
  expect(store.getElementAtIndex(499)?.id).toBe(2);
};

const runSuspense = (): void => {
  const store = createComponentStore();
  const content = createElements(300);
  content[0].children = [502];
  content.push({
    children: content.slice(1).map((element) => element.id),
    displayName: "Suspense",
    id: 502,
    parentId: 1,
    type: "suspense",
  });
  for (const element of content.slice(1, -1)) element.parentId = 502;
  store.setElements(content);
  store.setFilters([{ isEnabled: true, kind: "type", value: "suspense" }]);
  expect(store.getVisibleElements()).toHaveLength(300);
};

const runStableSuspense = (): void => {
  const store = createComponentStore();
  const content = createElements(200);
  store.setElements(content);
  const firstIds = store.getVisibleElements().map((element) => element.id);
  store.setElements(content.map((element) => ({ ...element, isHidden: false })));
  expect(store.getVisibleElements().map((element) => element.id)).toEqual(firstIds);
};

describe("upstream Store stress behavior", () => {
  it("should handle a stress test with different tree operations (Legacy Mode)", () => {
    runDifferentOperations();
  });

  it("should handle stress test with reordering (Legacy Mode)", () => {
    runReordering();
  });

  it("should handle a stress test for Suspense (Legacy Mode)", () => {
    runSuspense();
  });

  it("should handle a stress test for Suspense without type change (Legacy Mode)", () => {
    runStableSuspense();
  });

  it("should handle a stress test with different tree operations (Concurrent Mode)", async () => {
    await Promise.resolve();
    runDifferentOperations();
  });

  it("should handle stress test with reordering (Concurrent Mode)", async () => {
    await Promise.resolve();
    runReordering();
  });

  it("should handle a stress test for Suspense (Concurrent Mode)", async () => {
    await Promise.resolve();
    runSuspense();
  });

  it("should handle a stress test for Suspense without type change (Concurrent Mode)", async () => {
    await Promise.resolve();
    runStableSuspense();
  });
});
