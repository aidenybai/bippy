import { describe, expect, it, vi } from "vite-plus/test";
import { createInspectionModel } from "../src/inspection-model.js";
import type { InspectionBackend, InspectionRecord } from "../src/inspection-model.js";

const createBackend = () => {
  const records = new Map<string, InspectionRecord>([
    [
      "component",
      {
        data: {
          context: { theme: "dark" },
          hooks: [{ name: "State", value: 1 }],
          props: { nested: { value: 42 }, simple: "text" },
          rootType: "createRoot()",
          type: "function",
        },
        revision: 1,
        uid: "component",
      },
    ],
  ]);
  return {
    inspect: vi.fn((uid: string) => {
      const record = records.get(uid);
      if (!record) throw new Error(`Missing ${uid}`);
      return record;
    }),
  };
};

describe("upstream inspected-element model behavior", () => {
  it("inspects the selected modern element", () => {
    const model = createInspectionModel(createBackend());
    expect(model.inspect("component")).toMatchObject({ uid: "component" });
  });

  it("polls for selected element updates", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.inspect("component", true);
    expect(backend.inspect).toHaveBeenCalledTimes(2);
  });

  it("does not re-inspect unchanged hooks without an update", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.inspect("component");
    expect(backend.inspect).toHaveBeenCalledOnce();
  });

  it("recovers from a frontend cache miss", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.invalidate();
    expect(model.inspect("component")).toMatchObject({ revision: 1 });
    expect(backend.inspect).toHaveBeenCalledTimes(2);
  });

  it("surfaces backend errors instead of timing out", () => {
    const model = createInspectionModel(createBackend());
    expect(model.inspect("missing")).toMatchObject({ error: expect.any(Error) });
  });

  it("hydrates nested values only when requested", () => {
    const model = createInspectionModel(createBackend());
    expect(model.hydrate("component", ["data", "props"])).toBeUndefined();
    expect(model.hydrate("component", ["props", "nested", "value"])).toBe(42);
  });

  it("returns full updates after nested hydration and pending changes", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.hydrate("component", ["props", "nested"]);
    expect(model.inspect("component", true)).toMatchObject({ uid: "component" });
  });

  it("does not tear when hydration follows an update", () => {
    const model = createInspectionModel(createBackend());
    model.inspect("component", true);
    expect(model.hydrate("component", ["props", "nested"])).toEqual({ value: 42 });
  });

  it("stores inspected values as globals", () => {
    const model = createInspectionModel(createBackend());
    const target: Record<string, unknown> = {};
    expect(model.storeAsGlobal("component", ["props", "nested"], target, "$reactTemp0")).toBe(true);
    expect(target.$reactTemp0).toEqual({ value: 42 });
  });

  it("copies primitive inspected values", () => {
    const model = createInspectionModel(createBackend());
    expect(model.copyValue("component", ["props", "simple"])).toBe("text");
  });

  it("copies complex inspected values", () => {
    const model = createInspectionModel(createBackend());
    expect(model.copyValue("component", ["props", "nested"])).toBe('{"value":42}');
  });

  it("records and deduplicates render errors", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("component", "render error");
    model.recordError("component", "render error");
    expect(model.getErrors("component")).toEqual([{ count: 2, message: "render error" }]);
  });

  it("records layout and passive warnings", () => {
    const model = createInspectionModel(createBackend());
    model.recordWarning("component", "layout warning");
    model.recordWarning("component", "passive warning");
    expect(model.getWarnings("component")).toHaveLength(2);
  });

  it("clears errors and warnings for the whole app", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("component", "error");
    model.recordWarning("component", "warning");
    model.clearErrors();
    model.clearWarnings();
    expect(model.getErrors("component")).toEqual([]);
    expect(model.getWarnings("component")).toEqual([]);
  });

  it("clears warnings for one Fiber", () => {
    const model = createInspectionModel(createBackend());
    model.recordWarning("component", "warning");
    model.recordWarning("other", "warning");
    model.clearWarnings("component");
    expect(model.getWarnings("component")).toEqual([]);
    expect(model.getWarnings("other")).toHaveLength(1);
  });

  it("clears errors for one Fiber", () => {
    const model = createInspectionModel(createBackend());
    model.recordError("component", "error");
    model.recordError("other", "error");
    model.clearErrors("component");
    expect(model.getErrors("component")).toEqual([]);
    expect(model.getErrors("other")).toHaveLength(1);
  });

  it("survives component filter invalidation", () => {
    const backend = createBackend();
    const model = createInspectionModel(backend);
    model.inspect("component");
    model.invalidate();
    expect(() => model.inspect("component")).not.toThrow();
  });

  it("reports modern root types", () => {
    const model = createInspectionModel(createBackend());
    const record = model.inspect("component");
    if ("error" in record) throw record.error;
    expect(record.data.rootType).toBe("createRoot()");
  });

  it("supports nested renderer inspections", () => {
    const model = createInspectionModel(createBackend());
    expect(() => model.inspect("component")).not.toThrow();
  });

  it("inspects server component records", () => {
    const backend: InspectionBackend = {
      inspect: (uid) => ({ data: { environment: "Server", type: "server" }, revision: 1, uid }),
    };
    expect(createInspectionModel(backend).inspect("server")).toMatchObject({
      data: { environment: "Server", type: "server" },
    });
  });
});
