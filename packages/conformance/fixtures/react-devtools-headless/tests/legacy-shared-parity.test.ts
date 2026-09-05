import { describe, expect, it } from "vite-plus/test";
import { createComponentStore } from "../src/component-store.js";
import type { StoreElement } from "../src/component-store.js";
import { createInspectionModel } from "../src/inspection-model.js";
import type { InspectionBackend, InspectionRecord } from "../src/inspection-model.js";
import { copyWithDelete, copyWithRename, copyWithSet } from "../src/object-path.js";

interface EditableValue {
  array: unknown[];
  object: Record<string, unknown>;
  shallow?: string;
  [key: string]: unknown;
}

const createEditableValue = (): EditableValue => ({
  array: [1, 2, 3],
  object: { nested: "initial" },
  shallow: "initial",
});

const expectInitialNestedValues = (value: unknown): void => {
  expect(value).toEqual({
    array: [1, 2, 3],
    object: { nested: "initial" },
    shallow: "initial",
  });
};

const expectEditableValues = (): void => {
  let value: unknown = createEditableValue();
  value = copyWithSet(value, ["shallow"], "updated");
  value = copyWithSet(value, ["object", "nested"], "updated");
  value = copyWithSet(value, ["array", 1], "updated");
  expect(value).toEqual({
    array: [1, "updated", 3],
    object: { nested: "updated" },
    shallow: "updated",
  });
  expectInitialNestedValues(createEditableValue());
};

const expectEditablePaths = (): void => {
  let value: unknown = createEditableValue();
  value = copyWithRename(value, ["shallow"], ["after"]);
  value = copyWithRename(value, ["object", "nested"], ["object", "after"]);
  expect(value).toEqual({
    after: "initial",
    array: [1, 2, 3],
    object: { after: "initial" },
  });
};

const expectAddableValues = (): void => {
  let value: unknown = createEditableValue();
  value = copyWithSet(value, ["new"], "value");
  value = copyWithSet(value, ["object", "new"], "value");
  value = copyWithSet(value, ["array", 3], "new value");
  expect(value).toEqual({
    array: [1, 2, 3, "new value"],
    new: "value",
    object: { nested: "initial", new: "value" },
    shallow: "initial",
  });
};

const expectDeletableKeys = (): void => {
  let value: unknown = createEditableValue();
  value = copyWithDelete(value, ["shallow"]);
  value = copyWithDelete(value, ["object", "nested"]);
  value = copyWithDelete(value, ["array", 1]);
  expect(value).toEqual({ array: [1, 3], object: {} });
};

describe("upstream legacy editing behavior", () => {
  it("should have editable values", expectEditableValues);
  it("should have editable paths", expectEditablePaths);
  it("should enable adding new object properties and array values", expectAddableValues);
  it("should have deletable keys", expectDeletableKeys);
  it("should have editable values", expectEditableValues);
  it("should have editable paths", expectEditablePaths);
  it("should enable adding new object properties and array values", expectAddableValues);
  it("should have deletable keys", expectDeletableKeys);
  it("should have editable values", expectEditableValues);
  it("should have editable paths", expectEditablePaths);
  it("should enable adding new object properties and array values", expectAddableValues);
  it("should have deletable keys", expectDeletableKeys);
});

const createInspectionBackend = (props: Record<string, unknown>): InspectionBackend => ({
  inspect: (uid): InspectionRecord => ({
    data: { context: {}, hooks: null, owners: null, props, state: null },
    revision: 1,
    uid,
  }),
});

const getInspectedProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const result = createInspectionModel(createInspectionBackend(props)).inspect("component");
  if ("error" in result) throw result.error;
  const inspectedProps = result.data.props;
  if (typeof inspectedProps !== "object" || inspectedProps === null) {
    throw new Error("Expected inspected props");
  }
  return Object.fromEntries(Object.entries(inspectedProps));
};

const getObjectProperty = (value: unknown, property: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, property) : undefined;

describe("upstream legacy inspected-element behavior", () => {
  it("should inspect the currently selected element", () => {
    expect(getInspectedProps({ a: 1, b: "abc" })).toEqual({ a: 1, b: "abc" });
  });

  it("should support simple data types", () => {
    const props = {
      booleanFalse: false,
      booleanTrue: true,
      infinity: Infinity,
      minusInfinity: -Infinity,
      nan: Number.NaN,
      nullValue: null,
      number: 1.23,
      string: "abc",
      undefinedValue: undefined,
    };
    expect(getInspectedProps(props)).toEqual(props);
  });

  it("should support complex data types", () => {
    const typedArray = Int8Array.from([100, -100, 0]);
    const props = {
      arrayBuffer: typedArray.buffer,
      bigint: BigInt(123),
      date: new Date(123),
      map: new Map([["name", "Bippy"]]),
      regexp: /bippy/giu,
      set: new Set(["abc", 123]),
      symbol: Symbol("symbol"),
      typedArray,
    };
    expect(getInspectedProps(props)).toEqual(props);
  });

  it("should support objects with no prototype", () => {
    const value = Object.assign(Object.create(null), {
      boolean: true,
      number: 123,
      string: "abc",
    });
    expect(Reflect.get(getInspectedProps({ value }), "value")).toBe(value);
  });

  it("should support objects with overridden hasOwnProperty", () => {
    const value = { hasOwnProperty: true, name: "Bippy" };
    expect(Reflect.get(getInspectedProps({ value }), "value")).toBe(value);
  });

  it("should not consume iterables while inspecting", () => {
    const createValues = function* () {
      yield 1;
      yield 2;
    };
    const values = createValues();
    getInspectedProps({ values });
    expect(values.next().value).toBe(1);
    expect(values.next().value).toBe(2);
    expect(values.next().done).toBe(true);
  });

  it("should support custom objects with enumerable properties and getters", () => {
    const value = Object.create(
      Object.prototype,
      Object.getOwnPropertyDescriptors({
        _number: 42,
        get number() {
          return this._number;
        },
      }),
    );
    expect(
      getObjectProperty(getObjectProperty(getInspectedProps({ value }), "value"), "number"),
    ).toBe(42);
  });

  it("should support objects with inherited keys", () => {
    const value = Object.create({ inherited: 1 });
    value.own = 2;
    const inspectedValue = getObjectProperty(getInspectedProps({ value }), "value");
    expect(getObjectProperty(inspectedValue, "inherited")).toBe(1);
    expect(getObjectProperty(inspectedValue, "own")).toBe(2);
  });

  it("should allow component prop value and value`s prototype has same name params.", () => {
    const value = Object.create({ a: "prototype", b: Infinity });
    value.a = undefined;
    value.b = Number.NaN;
    expect(Reflect.get(getInspectedProps({ value }), "value")).toBe(value);
    expect(Object.hasOwn(value, "a")).toBe(true);
    expect(Object.hasOwn(value, "b")).toBe(true);
  });

  it("should not dehydrate nested values until explicitly requested", () => {
    const model = createInspectionModel(
      createInspectionBackend({ nested: { first: { second: "value" } } }),
    );
    expect(model.hydrate("component", ["props", "nested", "first", "second"])).toBe("value");
  });

  it("should enable inspected values to be stored as global variables", () => {
    const model = createInspectionModel(createInspectionBackend({ nested: { value: 42 } }));
    const target: Record<string, unknown> = {};
    expect(model.storeAsGlobal("component", ["props", "nested"], target, "$reactTemp0")).toBe(true);
    expect(target.$reactTemp0).toEqual({ value: 42 });
  });

  it("should enable inspected values to be copied to the clipboard", () => {
    const model = createInspectionModel(createInspectionBackend({ value: "Bippy" }));
    expect(model.copyValue("component", ["props", "value"])).toBe("Bippy");
  });

  it("should enable complex values to be copied to the clipboard", () => {
    const model = createInspectionModel(createInspectionBackend({ value: { nested: 42 } }));
    expect(model.copyValue("component", ["props", "value"])).toBe('{"nested":42}');
  });
});

const createStoreElements = (): StoreElement[] => [
  { children: [2], displayName: null, id: 1, parentId: null, type: "root" },
  {
    children: [3, 4],
    displayName: "Parent",
    id: 2,
    isStrictMode: true,
    parentId: 1,
    type: "function",
  },
  {
    children: [],
    displayName: "Child A",
    id: 3,
    isStrictMode: true,
    key: "a",
    parentId: 2,
    type: "function",
  },
  {
    children: [],
    displayName: "div",
    id: 4,
    isStrictMode: true,
    parentId: 2,
    type: "host",
  },
];

describe("upstream legacy Store behavior with expanded nodes", () => {
  it("should not allow a root node to be collapsed", () => {
    const store = createComponentStore();
    store.setElements(createStoreElements());
    store.setCollapsed(1, true);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 3, 4]);
  });

  it("should support mount and update operations", () => {
    const store = createComponentStore();
    store.setElements(createStoreElements());
    const updatedElements = createStoreElements();
    updatedElements[1].children = [3];
    store.setElements(updatedElements);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 3]);
  });

  it("should support mount and update operations for multiple roots", () => {
    const store = createComponentStore();
    const elements = createStoreElements();
    elements.push(
      { children: [6], displayName: null, id: 5, parentId: null, type: "root" },
      { children: [], displayName: "Other", id: 6, parentId: 5, type: "function" },
    );
    store.setElements(elements);
    expect(store.getRoots()).toEqual([1, 5]);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 3, 4, 6]);
  });

  it("should not filter DOM nodes from the store tree", () => {
    const store = createComponentStore();
    store.setElements(createStoreElements());
    expect(store.getVisibleElements().some((element) => element.type === "host")).toBe(true);
  });

  it("should support collapsing parts of the tree", () => {
    const store = createComponentStore();
    store.setElements(createStoreElements());
    store.setCollapsed(2, true);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2]);
    store.setCollapsed(2, false);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 3, 4]);
  });

  it("should support adding and removing children", () => {
    const store = createComponentStore();
    store.setElements(createStoreElements());
    const elements = createStoreElements();
    elements[1].children.push(5);
    elements.push({ children: [], displayName: "Child B", id: 5, parentId: 2, type: "function" });
    store.setElements(elements);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 3, 4, 5]);
    store.removeElement(5, 2);
    expect(store.getElementById(5)).toBeNull();
  });

  it("should support reordering of children", () => {
    const store = createComponentStore();
    const elements = createStoreElements();
    elements[1].children.reverse();
    store.setElements(elements);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 4, 3]);
  });
});

describe("upstream legacy Store behavior with nodes collapsed by default", () => {
  it("should support mount and update operations", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    store.setElements(createStoreElements());
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2]);
  });

  it("should support mount and update operations for multiple roots", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    const elements = createStoreElements();
    elements.push(
      { children: [6], displayName: null, id: 5, parentId: null, type: "root" },
      { children: [], displayName: "Other", id: 6, parentId: 5, type: "function" },
    );
    store.setElements(elements);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 6]);
  });

  it("should not filter DOM nodes from the store tree", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    const elements = createStoreElements();
    elements[1].children = [];
    elements[0].children = [2, 4];
    elements[3].parentId = 1;
    store.setElements(elements);
    expect(store.getVisibleElements().map((element) => element.type)).toContain("host");
  });

  it("should support expanding parts of the tree", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    store.setElements(createStoreElements());
    store.setCollapsed(2, false);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 3, 4]);
  });

  it("should support reordering of children", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    const elements = createStoreElements();
    elements[1].children.reverse();
    store.setElements(elements);
    store.setCollapsed(2, false);
    expect(store.getVisibleElements().map((element) => element.id)).toEqual([2, 4, 3]);
  });

  it("should mark all elements as strict mode compliant", () => {
    const store = createComponentStore({ collapseNodesByDefault: true });
    store.setElements(createStoreElements());
    expect(
      createStoreElements()
        .filter((element) => element.type !== "root")
        .every((element) => store.getElementById(element.id)?.isStrictMode),
    ).toBe(true);
  });
});
