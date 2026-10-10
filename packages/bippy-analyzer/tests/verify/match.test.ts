import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource, makeInstructionId } from "../../src/core/hir/hir.js";
import type { Binding, SymbolicValue } from "../../src/core/inference/types.js";
import { matchesExpected, normalizeShapes, toExpected } from "./match.js";
import type { Shape } from "./types.js";

const NO_KNOWN_COMPONENTS = new Map<string, string>();

const createBinding = (name: string): Binding => ({
  id: 0,
  name,
  kind: "state",
  hookKind: "useState",
  propName: null,
  loc: GeneratedSource,
  domain: { kind: "Unknown", reason: "unknown" },
  samples: [],
  initial: null,
});

const element = (tag: string, children: SymbolicValue[] = []): SymbolicValue => ({
  kind: "JsxExpression",
  tag: { kind: "BuiltinTag", name: tag },
  props: [],
  children,
  loc: GeneratedSource,
});
const component = (tag: string): SymbolicValue => ({
  kind: "JsxExpression",
  tag: { kind: "Component", name: tag, declaration: `/app/${tag}.tsx#${tag}` },
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
      decision: { terminalId: makeInstructionId(0), probe: "truthy", loc: GeneratedSource },
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
});
