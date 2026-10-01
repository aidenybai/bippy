import { expect, it } from "vite-plus/test";
import { enterSsa } from "../src/compiler/enter-ssa.js";
import { eliminateRedundantPhis } from "../src/compiler/eliminate-phis.js";
import { propagateConstants } from "../src/compiler/propagate-constants.js";
import { verifySsa } from "../src/compiler/verify-ssa.js";
import { CompilerInvariantError } from "../src/compiler/ir.js";
import { createGraph } from "./helpers/ssa-graph.js";

it("seals and simplifies mutually recursive phis in an irreducible graph", () => {
  const builder = createGraph();
  const entry = builder.block();
  const left = builder.block();
  const right = builder.block();
  const exit = builder.block();
  builder.emit(entry, "constant", 0, [], 7);
  builder.emit(entry, "input", 1);
  for (const block of [entry, left, right])
    block.terminal = { kind: "branch", value: 1, edges: [] };
  builder.edge(entry, left, "truthy");
  builder.edge(entry, right, "falsy");
  builder.edge(left, right, "truthy");
  builder.edge(left, exit, "falsy");
  builder.edge(right, left, "truthy");
  builder.edge(right, exit, "falsy");
  builder.emit(left, "read", 2, [0]);
  builder.emit(right, "read", 3, [0]);
  exit.terminal = { kind: "return", value: 0, edges: [] };
  const graph = enterSsa(builder.graph);
  verifySsa(graph);
  expect([...graph.blocks.values()].flatMap((block) => block.phis).length).toBeGreaterThan(1);
  expect(eliminateRedundantPhis(graph).size).toBeGreaterThan(1);
  verifySsa(graph);
  expect([...graph.blocks.values()].flatMap((block) => block.phis)).toEqual([]);
  const returned = graph.blocks.get(exit.id)?.terminal.value;
  expect(returned).not.toBeNull();
  expect(propagateConstants(graph).values.get(returned!)).toEqual({ kind: "constant", value: 7 });
});

it("keys phi operands by edge rather than predecessor block", () => {
  const builder = createGraph();
  const entry = builder.block();
  const joined = builder.block();
  builder.emit(entry, "constant", 0, [], 7);
  builder.emit(entry, "input", 1);
  entry.terminal = { kind: "branch", value: 1, edges: [] };
  const trueEdge = builder.edge(entry, joined, "truthy");
  const falseEdge = builder.edge(entry, joined, "falsy");
  joined.terminal = { kind: "return", value: 0, edges: [] };
  const graph = enterSsa(builder.graph);
  verifySsa(graph);
  expect([...graph.blocks.get(joined.id)!.phis[0].operands.keys()]).toEqual([trueEdge, falseEdge]);
  eliminateRedundantPhis(graph);
  expect(graph.blocks.get(joined.id)!.phis).toEqual([]);
});

it("preserves genuine loop-carried definitions", () => {
  const builder = createGraph();
  const entry = builder.block();
  const header = builder.block();
  const body = builder.block();
  const exit = builder.block();
  builder.emit(entry, "constant", 0, [], 0);
  builder.emit(entry, "input", 1);
  builder.edge(entry, header);
  header.terminal = { kind: "branch", value: 1, edges: [] };
  builder.edge(header, body, "truthy");
  builder.edge(header, exit, "falsy");
  builder.emit(body, "constant", 0, [], 1);
  builder.edge(body, header);
  exit.terminal = { kind: "return", value: 0, edges: [] };
  const graph = enterSsa(builder.graph);
  eliminateRedundantPhis(graph);
  verifySsa(graph);
  expect(graph.blocks.get(header.id)!.phis.some((phi) => phi.variable === 0)).toBe(true);
  expect(propagateConstants(graph).values.get(graph.blocks.get(exit.id)!.terminal.value!)).toEqual({
    kind: "overdefined",
  });
});

it("ignores unreachable predecessors before constructing phis", () => {
  const builder = createGraph();
  const entry = builder.block();
  const dead = builder.block();
  const exit = builder.block();
  builder.emit(entry, "constant", 0, [], 7);
  builder.edge(entry, exit);
  builder.edge(dead, exit);
  exit.terminal = { kind: "return", value: 0, edges: [] };
  const graph = enterSsa(builder.graph);
  verifySsa(graph);
  expect(graph.blocks.has(dead.id)).toBe(false);
  expect(graph.edges.size).toBe(1);
  expect(graph.blocks.get(exit.id)!.phis).toEqual([]);
});

it("propagates only executable phi inputs", () => {
  const builder = createGraph();
  const entry = builder.block();
  const left = builder.block();
  const right = builder.block();
  const exit = builder.block();
  builder.emit(entry, "constant", 0, [], 0);
  builder.emit(entry, "constant", 1, [], 1);
  entry.terminal = { kind: "branch", value: 1, edges: [] };
  builder.edge(entry, left, "truthy");
  const unreachable = builder.edge(entry, right, "falsy");
  builder.emit(left, "constant", 0, [], 7);
  builder.emit(right, "constant", 0, [], 9);
  builder.edge(left, exit);
  builder.edge(right, exit);
  exit.terminal = { kind: "return", value: 0, edges: [] };
  const graph = enterSsa(builder.graph);
  eliminateRedundantPhis(graph);
  verifySsa(graph);
  const analysis = propagateConstants(graph);
  expect(analysis.executableEdges.has(unreachable)).toBe(false);
  expect(analysis.values.get(graph.blocks.get(exit.id)!.terminal.value!)).toEqual({
    kind: "constant",
    value: 7,
  });
});

it("constructs long predecessor chains without recursive reads", () => {
  const builder = createGraph();
  const entry = builder.block();
  builder.emit(entry, "constant", 0, [], 7);
  let previous = entry;
  for (let index = 0; index < 12000; index++) {
    const next = builder.block();
    builder.edge(previous, next);
    previous = next;
  }
  previous.terminal = { kind: "return", value: 0, edges: [] };
  const graph = enterSsa(builder.graph);
  verifySsa(graph);
  expect(graph.blocks.size).toBe(12001);
});

it("simplifies large phi cycles without recursive traversal", () => {
  const builder = createGraph();
  const entry = builder.block();
  const headers = Array.from({ length: 5000 }, builder.block);
  builder.emit(entry, "constant", 0, [], 7);
  builder.emit(entry, "input", 1);
  let dispatch = entry;
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index];
    builder.emit(header, "read", 2, [0]);
    builder.edge(header, headers[(index + 1) % headers.length]);
    if (index === headers.length - 1) builder.edge(dispatch, header);
    else {
      dispatch.terminal = { kind: "branch", value: 1, edges: [] };
      builder.edge(dispatch, header, "truthy");
      const next = builder.block();
      builder.edge(dispatch, next, "falsy");
      dispatch = next;
    }
  }
  const graph = enterSsa(builder.graph);
  expect(eliminateRedundantPhis(graph).size).toBeGreaterThanOrEqual(headers.length);
  expect([...graph.blocks.values()].flatMap((block) => block.phis)).toEqual([]);
});

it("rejects undefined CFG variables", () => {
  const builder = createGraph();
  const entry = builder.block();
  builder.emit(entry, "copy", 1, [0]);
  entry.terminal = { kind: "return", value: 1, edges: [] };
  expect(() => enterSsa(builder.graph)).toThrow(CompilerInvariantError);
});

it("rejects a use that does not dominate its instruction", () => {
  const builder = createGraph();
  const entry = builder.block();
  builder.emit(entry, "constant", 0, [], 1);
  builder.emit(entry, "copy", 1, [0]);
  entry.terminal = { kind: "return", value: 1, edges: [] };
  const graph = enterSsa(builder.graph);
  const instructions = graph.blocks.get(entry.id)!.instructions;
  instructions[0].operands = [instructions[1].target];
  expect(() => verifySsa(graph)).toThrow("used before definition");
});
