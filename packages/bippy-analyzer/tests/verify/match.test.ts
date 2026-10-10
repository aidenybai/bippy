import { describe, expect, it } from "vite-plus/test";
import type { RenderNode } from "../../src/symbolic-tree/model.ts";
import { matchesExpected, normalizeShapes, toExpected } from "./match.ts";
import type { Shape } from "./types.ts";

const SPAN = { start: 0, end: 0, line: 1, column: 1, endLine: 1, endColumn: 1 };
const NO_KNOWN_COMPONENTS = new Map<string, string>();

const element = (tag: string, children: RenderNode[] = []): RenderNode => ({
  kind: "element",
  tag,
  isComponent: false,
  attributes: [],
  children,
});
const component = (tag: string): RenderNode => ({
  kind: "element",
  tag,
  isComponent: true,
  attributes: [],
  children: [],
});
const text = (value: string): RenderNode => ({ kind: "text", text: value });
const value = (): RenderNode => ({
  kind: "value",
  expression: { kind: "slot", slot: "count", path: [] },
});

const shapeElement = (tag: string, children: Shape[] = []): Shape => ({
  kind: "element",
  tag,
  children,
});
const shapeText = (value: string): Shape => ({ kind: "text", text: value });

const matches = (
  render: RenderNode,
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
        kind: "list",
        source: { kind: "slot", slot: "items", path: [] },
        item: element("li", [value()]),
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
    const render: RenderNode = {
      kind: "branch",
      condition: { kind: "slot", slot: "isDone", path: [] },
      whenTrue: element("s"),
      whenFalse: element("span"),
      span: SPAN,
      probe: "truthy",
    };
    expect(matches(render, [shapeElement("s")])).toBe(true);
    expect(matches(render, [shapeElement("span")])).toBe(true);
    expect(matches(render, [shapeElement("p")])).toBe(false);
  });

  it("matches project components by runtime name and other components by position", () => {
    const knownComponents = new Map([["TableElement", "Table"]]);
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
