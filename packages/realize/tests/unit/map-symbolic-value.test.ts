import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { createBindingValue, createUnknown } from "../../src/core/values/symbolic-values";
import type { SymbolicValue } from "../../src/core/types";
import { forEachSymbolicValue } from "../../src/core/values/for-each-symbolic-value";
import { mapSymbolicValue } from "../../src/core/values/map-symbolic-value";
import { createTestBinding } from "./helpers";

const count = createBindingValue(createTestBinding({ id: 0, name: "count" }));

const hasBinding = (value: SymbolicValue): boolean => {
  let isFound = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding") isFound = true;
  });
  return isFound;
};

const forgetBindings = (value: SymbolicValue): SymbolicValue =>
  mapSymbolicValue(value, (part) =>
    part.kind === "Binding" ? createUnknown("previous-render", GeneratedSource) : part,
  );

describe("mapping a symbolic value", () => {
  it.each<[string, SymbolicValue]>([
    [
      "JSX props and children",
      {
        kind: "JsxExpression",
        tag: { kind: "BuiltinTag", name: "b" },
        props: [
          {
            kind: "JsxAttribute",
            name: "title",
            value: count,
            handlerId: null,
            loc: GeneratedSource,
            file: "",
          },
        ],
        children: [count],
        loc: GeneratedSource,
      },
    ],
    ["fragment children", { kind: "JsxFragment", children: [count] }],
    [
      "hook arguments",
      {
        kind: "HookResult",
        hookKind: "Custom",
        name: "useThing",
        module: null,
        argumentValues: [count],
        loc: GeneratedSource,
      },
    ],
    [
      "bound arguments",
      {
        kind: "Bound",
        callee: { kind: "Global", name: "save", module: null },
        argumentValues: [count],
        loc: GeneratedSource,
      },
    ],
  ])("reaches bindings inside %s", (_name, value) => {
    expect(hasBinding(value)).toBe(true);
    expect(hasBinding(forgetBindings(value))).toBe(false);
  });
});
