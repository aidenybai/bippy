import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource, makeInstructionId } from "../../src/react-compiler/HIR/HIR";
import type { Binding, SymbolicValue } from "../../src/core/types";
import { matchesExpected, normalizeShapes, toExpected } from "../conformance/verifier/match";
import type { Shape } from "../conformance/verifier/types";
import { createTestBinding } from "./helpers";

const NO_KNOWN_COMPONENTS = new Map<string, string>();

const createBinding = (name: string): Binding => createTestBinding({ name, hookKind: "useState" });

const element = (tag: string, children: SymbolicValue[] = []): SymbolicValue => ({
  kind: "JsxExpression",
  tag: { kind: "BuiltinTag", name: tag },
  props: [],
  children,
  loc: GeneratedSource,
});
const component = (tag: string): SymbolicValue => ({
  kind: "JsxExpression",
  tag: {
    kind: "Component",
    name: tag,
    declaration: `/app/${tag}.tsx#${tag}`,
    isContext: false,
    reactExport: null,
  },
  props: [],
  children: [],
  loc: GeneratedSource,
});
const text = (value: string): SymbolicValue => ({ kind: "JSXText", value });
const binding = (name: string): SymbolicValue => ({
  kind: "Binding",
  binding: createBinding(name),
  path: [],
});
const value = (): SymbolicValue => binding("count");

const shapeElement = (tag: string, children: Shape[] = []): Shape => ({
  kind: "element",
  tag,
  children,
});
const shapeText = (value: string): Shape => ({ kind: "text", text: value });

const matches = (
  render: SymbolicValue,
  shapes: Shape[],
  knownComponents = NO_KNOWN_COMPONENTS,
): boolean => matchesExpected(toExpected(render, knownComponents), normalizeShapes(shapes));

describe("matchesExpected", () => {
  it("renders only the children of an aliased React export like Suspense", () => {
    const boundary: SymbolicValue = {
      kind: "JsxExpression",
      tag: {
        kind: "Component",
        name: "Boundary",
        declaration: null,
        isContext: false,
        reactExport: "Suspense",
      },
      props: [],
      children: [element("p", [text("Loading")])],
      loc: GeneratedSource,
    };
    expect(matches(boundary, [shapeElement("p", [shapeText("Loading")])])).toBe(true);
  });

  it("matches host elements, static text and value holes", () => {
    const render = element("button", [text("Count:"), value()]);
    expect(matches(render, [shapeElement("button", [shapeText("Count: "), shapeText("3")])])).toBe(
      true,
    );
    expect(matches(render, [shapeElement("a", [shapeText("Count:")])])).toBe(false);
    expect(matches(render, [shapeElement("button", [shapeText("Total:")])])).toBe(false);
  });

  it("matches a list against any number of items", () => {
    const render = element("ul", [
      {
        kind: "ArrayMap",
        array: binding("items"),
        item: element("li", [value()]),
        loc: GeneratedSource,
      },
    ]);
    expect(matches(render, [shapeElement("ul")])).toBe(true);
    expect(
      matches(render, [
        shapeElement("ul", [
          shapeElement("li", [shapeText("a")]),
          shapeElement("li", [shapeText("b")]),
        ]),
      ]),
    ).toBe(true);
    expect(matches(render, [shapeElement("ul", [shapeElement("p")])])).toBe(false);
  });

  it("matches either side of an unresolved branch", () => {
    const render: SymbolicValue = {
      kind: "Conditional",
      test: binding("isDone"),
      testKind: "truthy",
      consequent: element("s"),
      alternate: element("span"),
      branch: {
        terminalId: makeInstructionId(0),
        probe: "truthy",
        loc: GeneratedSource,
        file: "match.tsx",
      },
      guardKeys: [],
    };
    expect(matches(render, [shapeElement("s")])).toBe(true);
    expect(matches(render, [shapeElement("span")])).toBe(true);
    expect(matches(render, [shapeElement("p")])).toBe(false);
  });

  it("matches project components by runtime name and other components by position", () => {
    const knownComponents = new Map([["/app/TableElement.tsx#TableElement", "Table"]]);
    const render = element("div", [component("TableElement"), component("LabelPrimitive.Root")]);
    const rendered = [
      shapeElement("div", [
        { kind: "component", name: "Table" },
        { kind: "component", name: "Label" },
      ]),
    ];
    expect(matches(render, rendered, knownComponents)).toBe(true);
    const renamed = [
      shapeElement("div", [
        { kind: "component", name: "Grid" },
        { kind: "component", name: "Label" },
      ]),
    ];
    expect(matches(render, renamed, knownComponents)).toBe(false);
  });

  it("matches a library component that is a host element at runtime by its name", () => {
    const render = element("div", [component("Document")]);
    expect(matches(render, [shapeElement("div", [shapeElement("DOCUMENT")])])).toBe(true);
    expect(matches(render, [shapeElement("div", [shapeElement("PAGE")])])).toBe(false);
  });

  it("matches a context rendered as its own provider by its children", () => {
    const render: SymbolicValue = {
      kind: "JsxExpression",
      tag: {
        kind: "Component",
        name: "FontContext",
        declaration: null,
        isContext: true,
        reactExport: null,
      },
      props: [],
      children: [element("p")],
      loc: GeneratedSource,
    };
    expect(matches(render, [shapeElement("p")])).toBe(true);
  });

  it("matches the children a spread carries onto an element without its own", () => {
    const label: SymbolicValue = {
      kind: "JsxExpression",
      tag: { kind: "BuiltinTag", name: "label" },
      props: [{ kind: "JsxSpreadAttribute", value: binding("labelProps"), handlerId: null }],
      children: [],
      loc: GeneratedSource,
    };
    expect(matches(label, [shapeElement("label", [{ kind: "text", text: "Remember me" }])])).toBe(
      true,
    );
  });
});
