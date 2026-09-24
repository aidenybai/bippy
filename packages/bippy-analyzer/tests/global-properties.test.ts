import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { GlobalProperties } from "../src/evaluate/global-properties.js";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import { Interpreter } from "../src/evaluate/interpreter.js";
import { createPathPredicate } from "../src/evaluate/predicates.js";
import {
  describeValue,
  FALSE_VALUE,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
} from "../src/evaluate/values.js";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import type { CompilerDefine, RenderEnvironment } from "../src/types.js";

const rootDirectory = join(import.meta.dirname, "framework-fixtures/vite-globals");
const createInterpreter = (defines: Record<string, CompilerDefine>) =>
  new Interpreter(new ModuleGraph({ resolver: new ModuleResolver({ rootDirectory }) }), {
    viteEnvironment: { values: {}, defines, nodeEnvironment: "development" },
  });

it("restores the absence of cells first allocated in a fork", () => {
  const journals: HeapJournal[] = [];
  const properties = new GlobalProperties((cell) => {
    for (const journal of journals) if (journal.isPreexisting(cell)) journal.record(cell);
  });
  const journal = new HeapJournal();
  journals.push(journal);
  properties.set("value", UNDEFINED_VALUE);
  expect(properties.has("value")).toEqual(TRUE_VALUE);
  journal.endPath();
  expect(properties.has("value")).toEqual(FALSE_VALUE);
  journal.endPath();
  const predicate = createPathPredicate("global addition", null);
  journal.join("global addition", null, 0, predicate);
  expect(properties.has("value")).toMatchObject({
    kind: "branch",
    predicate,
    alternatives: [TRUE_VALUE, FALSE_VALUE],
  });
  expect(properties.get("value")).toEqual(UNDEFINED_VALUE);
});

it("retains possible absence after an uncertain assignment", () => {
  const properties = new GlobalProperties(() => {});
  properties.set("value", primitiveValue(3), true);
  expect(properties.has("value")).toMatchObject({
    kind: "branch",
    alternatives: [TRUE_VALUE, FALSE_VALUE],
  });
  expect(properties.get("value")).toMatchObject({
    kind: "branch",
    alternatives: [primitiveValue(3), UNDEFINED_VALUE],
  });
});

it("retains possible presence after an uncertain deletion", () => {
  const properties = new GlobalProperties(() => {});
  properties.set("value", UNDEFINED_VALUE);
  properties.delete("value", true);
  expect(properties.has("value")).toMatchObject({
    kind: "branch",
    alternatives: [FALSE_VALUE, TRUE_VALUE],
  });
  expect(properties.get("value")).toEqual(UNDEFINED_VALUE);
});

it("journals deletion separately from an undefined value", () => {
  const journals: HeapJournal[] = [];
  const properties = new GlobalProperties((cell) => {
    for (const journal of journals) if (journal.isPreexisting(cell)) journal.record(cell);
  });
  properties.set("value", UNDEFINED_VALUE);
  const journal = new HeapJournal();
  journals.push(journal);
  properties.delete("value");
  expect(properties.has("value")).toEqual(FALSE_VALUE);
  journal.endPath();
  expect(properties.has("value")).toEqual(TRUE_VALUE);
  journal.endPath();
  journal.join("global deletion", null, 0, createPathPredicate("global deletion", null));
  expect(properties.has("value")).toMatchObject({
    kind: "branch",
    alternatives: [FALSE_VALUE, TRUE_VALUE],
  });
});

it("restores host properties that were never explicitly injected", () => {
  const interpreter = new Interpreter(
    new ModuleGraph({ resolver: new ModuleResolver({ rootDirectory }) }),
    {
      page: {
        name: "original",
        cookie: "",
        localStorage: {},
        sessionStorage: {},
        windowKeys: ["name", "Math", "window", "globalThis"],
      },
    },
  );
  const module = interpreter.graph.addVirtualModule(
    join(rootDirectory, "host.ts"),
    `
    export const result = Math.random() > 0.5 ? (window.name = "changed", window.name) : window.name;
  `,
  );
  expect(module).not.toBeNull();
  if (module)
    expect(interpreter.evaluateModuleExport(module, "result")).toMatchObject({
      kind: "branch",
      alternatives: [primitiveValue("changed"), primitiveValue("original")],
    });
});

it("creates globals through sloppy assignments to unbound names", () => {
  const interpreter = createInterpreter({});
  const module = interpreter.graph.addVirtualModule(
    join(rootDirectory, "sloppy-global.js"),
    `
module.exports.run = () => {
  createdByAssignment = 4;
  return createdByAssignment;
};
`,
  );
  expect(module).not.toBeNull();
  if (!module) return;
  const result = interpreter.callValue(
    interpreter.evaluateModuleExport(module, "run"),
    [],
    interpreter.createModuleContext(module),
    null,
  );
  expect(result).toEqual(primitiveValue(4));
});

it.each(["", "globalThis.forbiddenAssignment = 1; delete globalThis.forbiddenAssignment;"])(
  "throws for strict assignments to absent globals after %s",
  (setup) => {
    const interpreter = createInterpreter({});
    const module = interpreter.graph.addVirtualModule(
      join(rootDirectory, "strict-global.js"),
      `
module.exports.run = () => {
  "use strict";
  ${setup}
  try {
    forbiddenAssignment = 4;
    return "assigned";
  } catch (error) {
    return error.name;
  }
};
`,
    );
    expect(module).not.toBeNull();
    if (!module) return;
    const result = interpreter.callValue(
      interpreter.evaluateModuleExport(module, "run"),
      [],
      interpreter.createModuleContext(module),
      null,
    );
    expect(result).toEqual(primitiveValue("ReferenceError"));
  },
);

it("preserves conditional global absence during strict assignments", () => {
  const interpreter = createInterpreter({});
  const module = interpreter.graph.addVirtualModule(
    join(rootDirectory, "conditional-global.js"),
    `
module.exports.run = () => {
  "use strict";
  globalThis.conditionalAssignment = 1;
  if (Math.random() > 0.5) delete globalThis.conditionalAssignment;
  try {
    conditionalAssignment = 4;
    return "assigned";
  } catch (error) {
    return error.name;
  }
};
`,
  );
  if (!module) throw new Error("Missing conditional global module");
  const result = interpreter.callValue(
    interpreter.evaluateModuleExport(module, "run"),
    [],
    interpreter.createModuleContext(module),
    null,
  );
  expect(result).toMatchObject({
    kind: "branch",
    alternatives: expect.arrayContaining([
      primitiveValue("assigned"),
      primitiveValue("ReferenceError"),
    ]),
  });
});

it("isolates client globals and builtin expandos from server writes", () => {
  const interpreter = createInterpreter({
    __BIPPY_REALM_VALUE__: { value: "client" },
    "Math.__bippyRealm": { value: 7 },
  });
  const module = interpreter.graph.addVirtualModule(
    join(rootDirectory, "realm.ts"),
    `
    export const readValue = () => globalThis.__BIPPY_REALM_VALUE__;
    export const readMath = () => Math.__bippyRealm;
    export const write = () => {
      globalThis.__BIPPY_REALM_VALUE__ = "server";
      Math.__bippyRealm = 9;
    };
  `,
  );
  expect(module).not.toBeNull();
  if (!module) return;
  const call = (name: string, environment: RenderEnvironment | null) =>
    interpreter.callValue(
      interpreter.evaluateModuleExport(module, name, environment),
      [],
      interpreter.createModuleContext(module, undefined, environment),
      null,
    );
  expect(call("readValue", null)).toEqual(primitiveValue("client"));
  expect(call("readMath", null)).toEqual(primitiveValue(7));
  expect(call("readMath", "server")).toEqual(UNDEFINED_VALUE);
  call("write", "server");
  expect(call("readValue", "server")).toEqual(primitiveValue("server"));
  expect(call("readMath", "server")).toEqual(primitiveValue(9));
  expect(call("readValue", null)).toEqual(primitiveValue("client"));
  expect(call("readMath", null)).toEqual(primitiveValue(7));
  expect(Reflect.has(globalThis, "__BIPPY_REALM_VALUE__")).toBe(false);
});

it("keeps opaque define expressions unknown without executing them", () => {
  const interpreter = createInterpreter({
    __BIPPY_OPAQUE__: {
      value: undefined,
      expression: "globalThis.__BIPPY_NATIVE_EXECUTED__ = true",
    },
  });
  expect(describeValue(interpreter.getWindowGlobal("__BIPPY_OPAQUE__"))).toContain(
    "Vite define __BIPPY_OPAQUE__",
  );
  expect(Reflect.has(globalThis, "__BIPPY_NATIVE_EXECUTED__")).toBe(false);
});

it.each([false, null, 0, ""])("creates an object when a dotted prefix is %j", (value) => {
  const interpreter = createInterpreter({
    __BIPPY_PREFIX__: { value },
    "__BIPPY_PREFIX__.value": { value: 7 },
  });
  const module = interpreter.graph.addVirtualModule(
    join(rootDirectory, "prefix.ts"),
    "export const result = __BIPPY_PREFIX__.value;",
  );
  expect(module).not.toBeNull();
  if (module) expect(interpreter.evaluateModuleExport(module, "result")).toEqual(primitiveValue(7));
});

it("rejects unsupported traversal rather than discarding a define", () => {
  expect(() =>
    createInterpreter({ __BIPPY_PREFIX__: { value: 1 }, "__BIPPY_PREFIX__.value": { value: 7 } }),
  ).toThrow("requires a known object target");
});

it("resolves global aliases before applying later serialized keys", () => {
  const interpreter = createInterpreter({
    "__BIPPY_ORDER__.value": { value: "child" },
    "globalThis.__BIPPY_ORDER__": { value: { value: "replacement" } },
  });
  const module = interpreter.graph.addVirtualModule(
    join(rootDirectory, "alias.ts"),
    "export const result = __BIPPY_ORDER__.value;",
  );
  expect(module).not.toBeNull();
  if (module)
    expect(interpreter.evaluateModuleExport(module, "result")).toEqual(
      primitiveValue("replacement"),
    );
});

it("uses serialized key order when parent definitions replace earlier globals", () => {
  const interpreter = createInterpreter({
    "__BIPPY_ORDER__.value": { value: "child" },
    __BIPPY_ORDER__: { value: { value: "parent" } },
  });
  const module = interpreter.graph.addVirtualModule(
    join(rootDirectory, "order.ts"),
    "export const result = __BIPPY_ORDER__.value;",
  );
  expect(module).not.toBeNull();
  if (module)
    expect(interpreter.evaluateModuleExport(module, "result")).toEqual(primitiveValue("child"));
});
