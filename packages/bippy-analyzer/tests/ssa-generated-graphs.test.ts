import { Script } from "node:vm";
import { expect, it } from "vite-plus/test";
import { enterSsa } from "../src/compiler/enter-ssa.js";
import { eliminateRedundantPhis } from "../src/compiler/eliminate-phis.js";
import { propagateConstants } from "../src/compiler/propagate-constants.js";
import { verifySsa } from "../src/compiler/verify-ssa.js";
import { getRequired, type ConstantAnalysis, type SsaGraph } from "../src/compiler/ir.js";
import { createGraph } from "./helpers/ssa-graph.js";
import { createSeededRandom } from "./helpers/differential-evaluator.js";

const executeGraph = (graph: SsaGraph, mask: number, constants?: ConstantAnalysis): number => {
  const values = new Map<number, number>();
  let blockId = graph.entry;
  let incoming: number | null = null;
  for (let step = 0; step < 1000; step++) {
    const block = getRequired(graph.blocks, blockId);
    const phis = block.phis.map((phi) => ({
      target: phi.target,
      value: getRequired(values, getRequired(phi.operands, incoming!)),
    }));
    for (const phi of phis) values.set(phi.target, phi.value);
    for (const instruction of block.instructions) {
      const fact = constants?.values.get(instruction.target);
      if (fact?.kind === "constant" && typeof fact.value === "number") {
        values.set(instruction.target, fact.value);
        continue;
      }
      const operands = instruction.operands.map((operand) => getRequired(values, operand));
      let value: number;
      switch (instruction.kind) {
        case "constant":
          if (typeof instruction.constant !== "number")
            throw new Error("Expected numeric fixture constant");
          value = instruction.constant;
          break;
        case "input":
          value =
            (mask >>> (getRequired(graph.definitions, instruction.target).variable - 100)) & 1;
          break;
        case "copy":
        case "read":
          value = operands[0];
          break;
        case "binary":
          if (instruction.operator === "+") value = operands[0] + operands[1];
          else if (instruction.operator === "-") value = operands[0] - operands[1];
          else if (instruction.operator === "^") value = operands[0] ^ operands[1];
          else throw new Error("Unexpected fixture operator");
          break;
        default:
          throw new Error("Unexpected fixture instruction");
      }
      values.set(instruction.target, value);
    }
    const terminal = block.terminal;
    if (terminal.kind === "return") return getRequired(values, terminal.value!);
    const edgeId =
      terminal.kind === "jump"
        ? terminal.edges[0]
        : terminal.edges.find(
            (edge) =>
              getRequired(graph.edges, edge).kind ===
              (getRequired(values, terminal.value!) ? "truthy" : "falsy"),
          );
    if (edgeId === undefined) throw new Error("No selected fixture edge");
    incoming = edgeId;
    blockId = getRequired(graph.edges, edgeId).to;
  }
  throw new Error("Fixture graph did not terminate");
};

it.each(Array.from({ length: 64 }, (_, index) => index + 1))(
  "matches native assignments before and after SSA optimization, graph seed %i",
  (seed) => {
    const getRandom = createSeededRandom(seed);
    const builder = createGraph();
    const entry = builder.block();
    const initial = Array.from({ length: 3 }, () => getRandom(17) - 8);
    const source = initial.map((value, index) => `let value${index}=${value};`);
    initial.forEach((value, index) => builder.emit(entry, "constant", index, [], value));
    for (let stage = 0; stage < 5; stage++) builder.emit(entry, "input", 100 + stage);
    let current = entry;
    for (let stage = 0; stage < 5; stage++) {
      const left = builder.block();
      const right = builder.block();
      const join = builder.block();
      current.terminal = { kind: "branch", value: 100 + stage, edges: [] };
      builder.edge(current, left, "truthy");
      builder.edge(current, right, "falsy");
      const arms = [left, right].map((block) => {
        const statements: string[] = [];
        for (let operation = 0; operation < 4; operation++) {
          const target = getRandom(3);
          const operand = getRandom(3);
          if (getRandom(3) === 0) {
            const value = getRandom(17) - 8;
            builder.emit(block, "constant", target, [], value);
            statements.push(`value${target}=${value};`);
          } else {
            const operator = ["+", "-", "^"][getRandom(3)];
            builder.emit(block, "binary", target, [target, operand]).operator = operator;
            statements.push(`value${target}=value${target}${operator}value${operand};`);
          }
        }
        builder.edge(block, join);
        return statements.join("");
      });
      source.push(`if((mask >>> ${stage}) & 1){${arms[0]}}else{${arms[1]}}`);
      current = join;
    }
    builder.emit(current, "binary", 0, [0, 1]).operator = "+";
    builder.emit(current, "binary", 0, [0, 2]).operator = "+";
    current.terminal = { kind: "return", value: 0, edges: [] };
    source.push("return value0+value1+value2;");
    const native = new Script(`(()=>{${source.join("\n")}})()`);
    const before = structuredClone(builder.graph);
    const graph = enterSsa(builder.graph);
    verifySsa(graph);
    const expected = Array.from({ length: 32 }, (_, mask) =>
      native.runInNewContext({ mask }, { timeout: 1000 }),
    );
    for (let mask = 0; mask < 32; mask++) expect(executeGraph(graph, mask)).toBe(expected[mask]);
    eliminateRedundantPhis(graph);
    verifySsa(graph);
    const constants = propagateConstants(graph);
    for (let mask = 0; mask < 32; mask++) {
      expect(executeGraph(graph, mask)).toBe(expected[mask]);
      expect(executeGraph(graph, mask, constants)).toBe(expected[mask]);
    }
    expect(builder.graph).toEqual(before);
    expect(eliminateRedundantPhis(graph).size).toBe(0);
  },
);
