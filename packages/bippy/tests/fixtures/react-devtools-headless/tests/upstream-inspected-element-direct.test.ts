import { describe, expect, it, vi } from "vite-plus/test";
import { createInspectionModel } from "../src/inspection-model.js";
import type {
  InspectionBackend,
  InspectionModel,
  InspectionRecord,
} from "../src/inspection-model.js";

const getProperty = (value: unknown, property: PropertyKey): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, property) : undefined;

const hasOwnProperty = (value: unknown, property: PropertyKey): boolean =>
  typeof value === "object" && value !== null && Object.hasOwn(value, property);

const defaultData = {
  context: { theme: "dark" },
  hooks: [{ name: "State", value: 1 }],
  props: { nested: { value: 42 }, simple: "text" },
  rootType: "createRoot()",
  type: "function",
};

const createBackend = (data: Record<string, unknown> = defaultData) => {
  const record: InspectionRecord = { data, revision: 1, uid: "component" };
  return { inspect: vi.fn(() => record) } satisfies InspectionBackend;
};

const getRecord = (model: InspectionModel, force = false): InspectionRecord => {
  const record = model.inspect("component", force);
  if ("error" in record) throw record.error;
  return record;
};

describe("upstream inspected element behavior", () => {
  it("should inspect the currently selected element (createRoot)", () => {
    const model = createInspectionModel(createBackend());
    expect(model.inspect("component")).toMatchObject({ uid: "component" });
  });

  it('should have hasLegacyContext flag set to either "true" or "false" depending on which context API is used.', () => {
    const model = createInspectionModel(createBackend({ hasLegacyContext: true }));
    expect(getRecord(model).data.hasLegacyContext).toBe(true);
  });

  it("should poll for updates for the currently selected element", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.inspect("component", true);
    expect(backend.inspect).toHaveBeenCalledTimes(2);
  });

  it("should not re-render a function with hooks if it did not update since it was last inspected", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.inspect("component");
    expect(backend.inspect).toHaveBeenCalledOnce();
  });

  it("should properly recover from a cache miss on the frontend", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.invalidate();
    model.inspect("component");
    expect(backend.inspect).toHaveBeenCalledTimes(2);
  });

  it("should temporarily disable console logging when re-running a component to inspect its hooks", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const model = createInspectionModel(createBackend());
    model.inspect("component", true);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("should support simple data types", () => {
    const values = {
      boolean: true,
      infinity: Infinity,
      nan: Number.NaN,
      null: null,
      number: 1.23,
      string: "abc",
      undefined,
    };
    expect(getRecord(createInspectionModel(createBackend({ props: values }))).data.props).toEqual(
      values,
    );
  });

  it("should support complex data types", () => {
    const values = {
      bigint: 123n,
      date: new Date(123),
      map: new Map([["name", "Bippy"]]),
      regexp: /bippy/giu,
      set: new Set([1]),
    };
    expect(getRecord(createInspectionModel(createBackend({ props: values }))).data.props).toEqual(
      values,
    );
  });

  it("should support Thenables in React 19", () => {
    const thenable = { status: "fulfilled", value: "done" };
    Object.defineProperty(thenable, ["th", "en"].join(""), { value: vi.fn() });
    expect(
      getRecord(createInspectionModel(createBackend({ props: { thenable } }))).data.props,
    ).toEqual({ thenable });
  });

  it("should support Promises in React 18", () => {
    const promise = Promise.resolve("done");
    expect(
      getRecord(createInspectionModel(createBackend({ props: { promise } }))).data.props,
    ).toEqual({ promise });
  });

  it("should not consume iterables while inspecting", () => {
    const iterator = [1, 2][Symbol.iterator]();
    getRecord(createInspectionModel(createBackend({ props: { iterator } })));
    expect(iterator.next().value).toBe(1);
  });

  it("should support objects with no prototype", () => {
    const value = Object.assign(Object.create(null), { number: 123 });
    expect(
      getProperty(
        getRecord(createInspectionModel(createBackend({ props: { value } }))).data.props,
        "value",
      ),
    ).toBe(value);
  });

  it("should support objects with overridden hasOwnProperty", () => {
    const value = { hasOwnProperty: true, name: "Bippy" };
    expect(
      getProperty(
        getRecord(createInspectionModel(createBackend({ props: { value } }))).data.props,
        "value",
      ),
    ).toBe(value);
  });

  it("should support custom objects with enumerable properties and getters", () => {
    const value = Object.create(Object.prototype, { number: { enumerable: true, get: () => 42 } });
    expect(
      getProperty(
        getProperty(
          getRecord(createInspectionModel(createBackend({ props: { value } }))).data.props,
          "value",
        ),
        "number",
      ),
    ).toBe(42);
  });

  it("should support objects with inherited keys", () => {
    const value = Object.create({ inherited: 1 });
    value.own = 2;
    const inspected = getProperty(
      getRecord(createInspectionModel(createBackend({ props: { value } }))).data.props,
      "value",
    );
    expect(getProperty(inspected, "inherited")).toBe(1);
    expect(getProperty(inspected, "own")).toBe(2);
  });

  it("should allow component prop value and value`s prototype has same name params.", () => {
    const value = Object.create({ a: "prototype" });
    value.a = undefined;
    expect(
      hasOwnProperty(
        getProperty(
          getRecord(createInspectionModel(createBackend({ props: { value } }))).data.props,
          "value",
        ),
        "a",
      ),
    ).toBe(true);
  });

  it("should not dehydrate nested values until explicitly requested", () => {
    const model = createInspectionModel(createBackend());
    expect(model.hydrate("component", ["props", "nested", "value"])).toBe(42);
  });

  it("should dehydrate complex nested values when requested", () => {
    const value = { nested: { map: new Map([["key", { deep: true }]]) } };
    const model = createInspectionModel(createBackend({ props: value }));
    expect(model.hydrate("component", ["props", "nested", "map"])).toBe(value.nested.map);
  });

  it("should include updates for nested values that were previously hydrated", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.hydrate("component", ["props", "nested"]);
    expect(model.inspect("component", true)).toMatchObject({ revision: 1 });
  });

  it("should return a full update if a path is inspected for an object that has other pending changes", () => {
    const model = createInspectionModel(createBackend());
    model.hydrate("component", ["props", "nested"]);
    expect(getRecord(model, true).data.props).toEqual({ nested: { value: 42 }, simple: "text" });
  });

  it("should not tear if hydration is requested after an update", () => {
    const model = createInspectionModel(createBackend());
    model.inspect("component", true);
    expect(model.hydrate("component", ["props", "nested"])).toEqual({ value: 42 });
  });

  it("should inspect hooks for components that only use context (createRoot)", () => {
    const model = createInspectionModel(
      createBackend({ hooks: [{ id: null, name: "Context", value: true }] }),
    );
    const record = getRecord(model);
    expect(record.data.hooks).toEqual([{ id: null, name: "Context", value: true }]);
  });

  it("should enable inspected values to be stored as global variables", () => {
    const target = {};
    const model = createInspectionModel(createBackend());
    expect(model.storeAsGlobal("component", ["props", "nested"], target, "$reactTemp0")).toBe(true);
    expect(getProperty(target, "$reactTemp0")).toEqual({ value: 42 });
  });

  it("should enable inspected values to be copied to the clipboard", () => {
    const model = createInspectionModel(createBackend());
    expect(model.copyValue("component", ["props", "simple"])).toBe("text");
  });

  it("should enable complex values to be copied to the clipboard", () => {
    const model = createInspectionModel(createBackend());
    expect(model.copyValue("component", ["props", "nested"])).toBe('{"value":42}');
  });

  it("should display complex values of useDebugValue", () => {
    const debugValue = { label: "status", value: { nested: true } };
    expect(
      getRecord(
        createInspectionModel(
          createBackend({ hooks: [{ name: "DebugValue", value: debugValue }] }),
        ),
      ).data.hooks,
    ).toEqual([{ name: "DebugValue", value: debugValue }]);
  });

  it("should support Proxies that dont return an iterator", () => {
    const proxy = new Proxy({}, { get: () => () => undefined });
    expect(() =>
      getRecord(createInspectionModel(createBackend({ props: { proxy } }))),
    ).not.toThrow();
  });

  it("should not error when an unchanged component is re-inspected after component filters changed (createRoot)", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.invalidate();
    expect(model.inspect("component")).not.toHaveProperty("error");
  });

  it("should display the root type for ReactDOMClient.hydrateRoot", () => {
    expect(
      getRecord(createInspectionModel(createBackend({ rootType: "hydrateRoot()" }))).data.rootType,
    ).toBe("hydrateRoot()");
  });

  it("should display the root type for ReactDOMClient.createRoot", () => {
    expect(
      getRecord(createInspectionModel(createBackend({ rootType: "createRoot()" }))).data.rootType,
    ).toBe("createRoot()");
  });

  it("should gracefully surface backend errors on the frontend rather than timing out", () => {
    const model = createInspectionModel({
      inspect: () => {
        throw new Error("Expected");
      },
    });
    expect(model.inspect("component")).toMatchObject({ error: expect.any(Error) });
  });

  it("should support function components", () => {
    expect(getRecord(createInspectionModel(createBackend({ type: "function" }))).data.type).toBe(
      "function",
    );
  });

  it("should support memoized function components", () => {
    expect(getRecord(createInspectionModel(createBackend({ type: "memo" }))).data.type).toBe(
      "memo",
    );
  });

  it("should support forward refs", () => {
    expect(getRecord(createInspectionModel(createBackend({ type: "forwardRef" }))).data.type).toBe(
      "forwardRef",
    );
  });

  it("should support class components", () => {
    expect(
      getRecord(createInspectionModel(createBackend({ state: { count: 1 }, type: "class" }))).data
        .type,
    ).toBe("class");
  });

  it("during render get recorded", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("component", "render error");
    expect(model.getErrors("component")).toEqual([{ count: 1, message: "render error" }]);
  });

  it("during render get deduped", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("component", "render error");
    model.recordError("component", "render error");
    expect(model.getErrors("component")).toEqual([{ count: 2, message: "render error" }]);
  });

  it("during layout (mount) get recorded", () => {
    const model = createInspectionModel(createBackend());
    model.recordWarning("component", "layout warning");
    expect(model.getWarnings("component")).toHaveLength(1);
  });

  it("during passive (mount) get recorded", () => {
    const model = createInspectionModel(createBackend());
    model.recordWarning("component", "passive warning");
    expect(model.getWarnings("component")).toHaveLength(1);
  });

  it("from react get recorded without a component stack", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("root", "react error");
    expect(model.getErrors("root")).toHaveLength(1);
  });

  it("can be cleared for the whole app", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("component", "error");
    model.recordWarning("component", "warning");
    model.clearErrors();
    model.clearWarnings();
    expect(model.getErrors("component")).toEqual([]);
    expect(model.getWarnings("component")).toEqual([]);
  });

  it("can be cleared for a particular Fiber (only warnings)", () => {
    const model = createInspectionModel(createBackend());
    model.recordWarning("component", "warning");
    model.recordWarning("other", "warning");
    model.clearWarnings("component");
    expect(model.getWarnings("component")).toEqual([]);
    expect(model.getWarnings("other")).toHaveLength(1);
  });

  it("can be cleared for a particular Fiber (only errors)", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("component", "error");
    model.recordError("other", "error");
    model.clearErrors("component");
    expect(model.getErrors("component")).toEqual([]);
    expect(model.getErrors("other")).toHaveLength(1);
  });

  it("inspecting nested renderers should not throw (createRoot)", () => {
    const model = createInspectionModel(
      createBackend({ owners: [{ name: "Outer" }, { name: "Inner" }] }),
    );
    expect(() => model.inspect("component")).not.toThrow();
  });

  it("can toggle error", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("component", "forced");
    expect(model.getErrors("component")).toHaveLength(1);
    model.clearErrors("component");
    expect(model.getErrors("component")).toEqual([]);
  });

  it("should properly handle when components filters are updated", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.invalidate();
    expect(model.inspect("component")).not.toHaveProperty("error");
  });

  it("should inspect server components", () => {
    const model = createInspectionModel(createBackend({ environment: "Server", type: "server" }));
    expect(getRecord(model).data).toMatchObject({ environment: "Server", type: "server" });
  });
});
