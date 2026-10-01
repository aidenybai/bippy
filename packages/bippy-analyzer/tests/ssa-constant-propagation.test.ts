import { expect, it } from "vite-plus/test";
import { enterSsa } from "../src/compiler/enter-ssa.js";
import { eliminateRedundantPhis } from "../src/compiler/eliminate-phis.js";
import { propagateConstants } from "../src/compiler/propagate-constants.js";
import { verifySsa } from "../src/compiler/verify-ssa.js";
import { getRequired, type FlowInstruction } from "../src/compiler/ir.js";
import type { StaticPrimitive } from "../src/types.js";
import { createGraph } from "./helpers/ssa-graph.js";

interface MergeCase {
  name: string;
  left: StaticPrimitive;
  right: StaticPrimitive;
  selected: string;
}

const values: StaticPrimitive[] = [
  undefined,
  null,
  false,
  true,
  0,
  -0,
  1,
  -1,
  NaN,
  Infinity,
  -Infinity,
  "",
  "same",
  1n,
];
const cases: MergeCase[] = values.flatMap((left, leftIndex) =>
  values.flatMap((right, rightIndex) =>
    ["both", "left", "right"].map((selected) => ({
      name: `left=${leftIndex}/right=${rightIndex}/${selected}`,
      left,
      right,
      selected,
    })),
  ),
);

it.each(cases)(
  "merges only executable scalar facts with SameValue: $name",
  ({ left, right, selected }) => {
    const builder = createGraph();
    const entry = builder.block();
    const passing = builder.block();
    const failing = builder.block();
    const join = builder.block();
    builder.emit(entry, selected === "both" ? "input" : "constant", 1, [], selected === "left");
    entry.terminal = { kind: "branch", value: 1, edges: [] };
    builder.edge(entry, passing, "truthy");
    builder.edge(entry, failing, "falsy");
    builder.emit(passing, "constant", 0, [], left);
    builder.emit(failing, "constant", 0, [], right);
    const leftEdge = builder.edge(passing, join);
    const rightEdge = builder.edge(failing, join);
    join.terminal = { kind: "return", value: 0, edges: [] };
    const graph = enterSsa(builder.graph);
    eliminateRedundantPhis(graph);
    verifySsa(graph);
    const result = propagateConstants(graph);
    const fact = getRequired(result.values, getRequired(graph.blocks, join.id).terminal.value!);
    if (selected === "both" && !Object.is(left, right)) expect(fact.kind).toBe("overdefined");
    else {
      expect(fact.kind).toBe("constant");
      expect(Object.is(fact.value, selected === "right" ? right : left)).toBe(true);
    }
    expect(result.executableEdges.has(leftEdge)).toBe(selected !== "right");
    expect(result.executableEdges.has(rightEdge)).toBe(selected !== "left");
    expect(propagateConstants(graph)).toEqual(result);
  },
);

const readKinds: FlowInstruction["kind"][] = ["constant", "uninitialized", "input"];

it.each(readKinds)("retains exception edges unless the read is proven safe: %s", (kind) => {
  const builder = createGraph();
  const entry = builder.block();
  const normal = builder.block();
  const failed = builder.block();
  const join = builder.block();
  builder.emit(entry, kind, 0, [], 7);
  builder.emit(entry, "read", 1, [0]);
  entry.terminal = { kind: "invoke", value: 1, edges: [] };
  builder.edge(entry, normal);
  const thrown = builder.edge(entry, failed, "throw");
  builder.emit(normal, "constant", 2, [], 1);
  builder.emit(failed, "constant", 2, [], 9);
  builder.edge(normal, join);
  builder.edge(failed, join);
  join.terminal = { kind: "return", value: 2, edges: [] };
  const graph = enterSsa(builder.graph);
  verifySsa(graph);
  const result = propagateConstants(graph);
  expect(result.executableEdges.has(thrown)).toBe(kind !== "constant");
  expect(result.values.get(getRequired(graph.blocks, join.id).terminal.value!)?.kind).toBe(
    kind === "constant" ? "constant" : "overdefined",
  );
});

it("does not collapse a phi cycle with distinct external definitions", () => {
  const builder = createGraph();
  const entry = builder.block();
  const left = builder.block();
  const right = builder.block();
  const first = builder.block();
  const second = builder.block();
  const exit = builder.block();
  builder.emit(entry, "input", 1);
  entry.terminal = { kind: "branch", value: 1, edges: [] };
  builder.edge(entry, left, "truthy");
  builder.edge(entry, right, "falsy");
  builder.emit(left, "constant", 0, [], 7);
  builder.emit(right, "constant", 0, [], 9);
  builder.edge(left, first);
  builder.edge(right, second);
  first.terminal = { kind: "branch", value: 1, edges: [] };
  second.terminal = { kind: "branch", value: 1, edges: [] };
  builder.emit(first, "read", 2, [0]);
  builder.emit(second, "read", 3, [0]);
  builder.edge(first, second, "truthy");
  builder.edge(first, exit, "falsy");
  builder.edge(second, exit, "truthy");
  builder.edge(second, first, "falsy");
  exit.terminal = { kind: "return", value: 0, edges: [] };
  const graph = enterSsa(builder.graph);
  eliminateRedundantPhis(graph);
  verifySsa(graph);
  expect(
    [...graph.blocks.values()].flatMap((block) => block.phis).filter((phi) => phi.variable === 0)
      .length,
  ).toBeGreaterThanOrEqual(2);
  expect(
    propagateConstants(graph).values.get(getRequired(graph.blocks, exit.id).terminal.value!)?.kind,
  ).toBe("overdefined");
});
