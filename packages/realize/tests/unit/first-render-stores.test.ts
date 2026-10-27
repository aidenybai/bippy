import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { getRegionData } from "../conformance/verifier/region-matching";
import { scoreComponent } from "../conformance/verifier/score";
import type { Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent } from "./helpers";

const renderPanel = (label: string): Shape[] => [
  {
    kind: "element",
    tag: "div",
    children: [
      { kind: "element", tag: "button", children: [{ kind: "text", text: "toggle" }] },
      { kind: "element", tag: "i", children: [{ kind: "text", text: label }] },
    ],
  },
];

const mountWith = (shapes: Shape[]): Observation => ({
  props: {},
  path: [],
  action: null,
  before: null,
  after: createCapture({ shapes, firstCommitShapes: shapes }),
});

describe("first render of a store", () => {
  const project = analyzeFixture("conformance-repros", "store-statics");
  const { analysis, report } = getComponent(project, "GetStateToggle");
  const score = (label: string, isOnFreshPage: boolean) =>
    scoreComponent(analysis, report, [mountWith(renderPanel(label))], new Map(), isOnFreshPage)
      .stateCounterexamples;

  it("reads a store's region as store data", () => {
    expect(report.regions.map((region) => getRegionData(analysis, region))).toEqual(["store"]);
  });

  it("accepts the store's initial state on a fresh page", () => {
    expect(score("closed", true)).toEqual([]);
  });

  it("refutes another state on a fresh page", () => {
    expect(score("open", true)).toEqual([expect.objectContaining({ path: ["first commit"] })]);
  });

  it("accepts any state once earlier mounts may have written the store", () => {
    expect(score("open", false)).toEqual([]);
  });
});
