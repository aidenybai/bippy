import { describe, expect, it } from "vite-plus/test";
import { toExpected } from "../conformance/verifier/match";
import { analyzeFixture, getComponent } from "./helpers";

describe("closures created inside an inlined call", () => {
  const project = analyzeFixture("conformance-repros", "inline-closure-captures");

  const getRenders = (name: string) =>
    getComponent(project, name).report.states.map((state) => toExpected(state.render, new Map()));

  const renderingText = (text: string) => [
    [
      {
        kind: "element",
        tag: "div",
        children: [{ kind: "element", tag: "i", children: [{ kind: "text", text }] }],
      },
    ],
  ];

  it("read a variable declared after them in the same call", () => {
    expect(getRenders("HoistedCapture")).toEqual(renderingText("three"));
  });

  it("read the last value the call wrote once it returns", () => {
    expect(getRenders("LaterWrite")).toEqual(renderingText("two"));
  });
});
