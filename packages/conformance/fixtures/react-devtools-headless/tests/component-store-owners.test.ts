import { describe, expect, it } from "vite-plus/test";
import { createComponentStore } from "../src/component-store.js";
import type { StoreElement } from "../src/component-store.js";

const createOwnerElements = (): StoreElement[] => [
  { children: [2], displayName: null, id: 1, parentId: null, type: "root" },
  { children: [3], displayName: "Root", id: 2, ownerId: null, parentId: 1, type: "function" },
  {
    children: [4],
    displayName: "Intermediate",
    id: 3,
    ownerId: 2,
    parentId: 2,
    type: "function",
  },
  { children: [5], displayName: "Wrapper", id: 4, ownerId: 3, parentId: 3, type: "function" },
  { children: [], displayName: "Leaf", id: 5, ownerId: 2, parentId: 4, type: "function" },
];

const ownerNames = (elements: StoreElement[], ownerId: number): Array<string | null> => {
  const store = createComponentStore();
  store.setElements(elements);
  return store.getOwnersTree(ownerId).map((element) => element.displayName);
};

describe("upstream Store owners-tree behavior", () => {
  it("should drill through intermediate components", () => {
    expect(ownerNames(createOwnerElements(), 2)).toEqual(["Root", "Intermediate", "Leaf"]);
    expect(ownerNames(createOwnerElements(), 3)).toEqual(["Intermediate", "Wrapper"]);
  });

  it("should drill through interleaved intermediate components", () => {
    const elements = createOwnerElements();
    elements.push({
      children: [],
      displayName: "DirectLeaf",
      id: 6,
      ownerId: 2,
      parentId: 2,
      type: "function",
    });
    elements[1].children.push(6);
    expect(ownerNames(elements, 2)).toEqual(["Root", "Intermediate", "Leaf", "DirectLeaf"]);
  });

  it("should show the proper owners list order and contents after insertions and deletions", () => {
    const elements = createOwnerElements();
    expect(ownerNames(elements, 2)).toEqual(["Root", "Intermediate", "Leaf"]);
    elements.push({
      children: [],
      displayName: "DirectLeaf",
      id: 6,
      ownerId: 2,
      parentId: 2,
      type: "function",
    });
    expect(ownerNames(elements, 2)).toEqual(["Root", "Intermediate", "Leaf", "DirectLeaf"]);
    expect(
      ownerNames(
        elements.filter((element) => element.id !== 3 && element.id !== 4),
        2,
      ),
    ).toEqual(["Root", "Leaf", "DirectLeaf"]);
  });

  it("should show the proper owners list ordering after reordered children", () => {
    const elements = createOwnerElements();
    elements.push(
      {
        children: [],
        displayName: "A",
        id: 6,
        key: "A",
        ownerId: 2,
        parentId: 2,
        type: "function",
      },
      {
        children: [],
        displayName: "B",
        id: 7,
        key: "B",
        ownerId: 2,
        parentId: 2,
        type: "function",
      },
    );
    expect(ownerNames(elements, 2)).toEqual(["Root", "Intermediate", "Leaf", "A", "B"]);
    const reordered = [
      elements[0],
      elements[1],
      elements[2],
      elements[3],
      elements[4],
      elements[6],
      elements[5],
    ];
    expect(ownerNames(reordered, 2)).toEqual(["Root", "Intermediate", "Leaf", "B", "A"]);
  });
});
