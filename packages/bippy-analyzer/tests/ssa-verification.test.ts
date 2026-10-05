import { expect, it } from "vite-plus/test";
import { enterSsa } from "../src/compiler/enter-ssa.js";
import { verifySsa } from "../src/compiler/verify-ssa.js";
import { CompilerInvariantError, getRequired, type SsaGraph } from "../src/compiler/ir.js";
import { createGraph } from "./helpers/ssa-graph.js";

interface InvalidGraphCase {
  name: string;
  mutate: (graph: SsaGraph) => void;
}

const getDiamond = (): SsaGraph => {
  const builder = createGraph();
  const entry = builder.block();
  const left = builder.block();
  const right = builder.block();
  const join = builder.block();
  builder.emit(entry, "constant", 0, [], 7);
  builder.emit(entry, "input", 1);
  entry.terminal = { kind: "branch", value: 1, edges: [] };
  builder.edge(entry, left, "truthy");
  builder.edge(entry, right, "falsy");
  builder.emit(left, "constant", 0, [], 9);
  builder.emit(right, "constant", 0, [], 11);
  builder.edge(left, join);
  builder.edge(right, join);
  join.terminal = { kind: "return", value: 0, edges: [] };
  return enterSsa(builder.graph);
};

const invalid: InvalidGraphCase[] = [
  {
    name: "missing phi predecessor",
    mutate: (graph) => {
      getRequired(graph.blocks, 3).phis[0].operands.delete(2);
    },
  },
  {
    name: "extra phi predecessor",
    mutate: (graph) => {
      getRequired(graph.blocks, 3).phis[0].operands.set(99, 0);
    },
  },
  {
    name: "cross-branch phi use",
    mutate: (graph) => {
      getRequired(graph.blocks, 3).phis[0].operands.set(
        2,
        getRequired(graph.blocks, 2).instructions[0].target,
      );
    },
  },
  {
    name: "undefined phi use",
    mutate: (graph) => {
      getRequired(graph.blocks, 3).phis[0].operands.set(2, 999);
    },
  },
  {
    name: "phi variable mismatch",
    mutate: (graph) => {
      getRequired(graph.blocks, 3).phis[0].variable = 1;
    },
  },
  {
    name: "duplicate definition",
    mutate: (graph) => {
      getRequired(graph.blocks, 1).instructions[0].target = 0;
    },
  },
  {
    name: "duplicate instruction identity",
    mutate: (graph) => {
      const instruction = getRequired(graph.blocks, 1).instructions[0];
      instruction.id = 0;
      getRequired(graph.definitions, instruction.target).instruction = 0;
    },
  },
  {
    name: "use before definition",
    mutate: (graph) => {
      const block = getRequired(graph.blocks, 0);
      block.instructions[0].operands = [block.instructions[1].target];
    },
  },
  {
    name: "non-dominating ordinary use",
    mutate: (graph) => {
      getRequired(graph.blocks, 2).instructions[0].operands = [
        getRequired(graph.blocks, 1).instructions[0].target,
      ];
    },
  },
  {
    name: "undefined terminal use",
    mutate: (graph) => {
      getRequired(graph.blocks, 3).terminal.value = 999;
    },
  },
  {
    name: "orphan definition",
    mutate: (graph) => {
      graph.definitions.set(999, { id: 999, variable: 0, block: 0, instruction: 999 });
    },
  },
  {
    name: "definition identity mismatch",
    mutate: (graph) => {
      getRequired(graph.definitions, 0).id = 999;
    },
  },
  {
    name: "definition block mismatch",
    mutate: (graph) => {
      getRequired(graph.definitions, 0).block = 3;
    },
  },
  {
    name: "missing definition variable",
    mutate: (graph) => {
      graph.variables.delete(0);
    },
  },
  {
    name: "variable identity mismatch",
    mutate: (graph) => {
      getRequired(graph.variables, 0).id = 999;
    },
  },
  {
    name: "block identity mismatch",
    mutate: (graph) => {
      getRequired(graph.blocks, 0).id = 999;
    },
  },
  {
    name: "edge identity mismatch",
    mutate: (graph) => {
      getRequired(graph.edges, 0).id = 999;
    },
  },
  {
    name: "orphan edge",
    mutate: (graph) => {
      graph.edges.set(999, { id: 999, from: 0, to: 3, kind: "normal" });
    },
  },
  {
    name: "missing edge",
    mutate: (graph) => {
      graph.edges.delete(0);
    },
  },
  {
    name: "wrong edge source",
    mutate: (graph) => {
      getRequired(graph.edges, 0).from = 2;
    },
  },
  {
    name: "wrong edge target",
    mutate: (graph) => {
      getRequired(graph.edges, 0).to = 2;
    },
  },
  {
    name: "duplicate outgoing edge",
    mutate: (graph) => {
      getRequired(graph.blocks, 0).terminal.edges.push(0);
    },
  },
  {
    name: "duplicate incoming edge",
    mutate: (graph) => {
      getRequired(graph.blocks, 1).predecessors.push(0);
    },
  },
  {
    name: "missing incoming edge",
    mutate: (graph) => {
      getRequired(graph.blocks, 1).predecessors = [];
    },
  },
  {
    name: "entry predecessor",
    mutate: (graph) => {
      getRequired(graph.blocks, 0).predecessors.push(0);
    },
  },
  {
    name: "missing branch test",
    mutate: (graph) => {
      getRequired(graph.blocks, 0).terminal.value = null;
    },
  },
  {
    name: "wrong branch edge kind",
    mutate: (graph) => {
      getRequired(graph.edges, 0).kind = "normal";
    },
  },
  {
    name: "non-branch terminal with two successors",
    mutate: (graph) => {
      getRequired(graph.blocks, 0).terminal.kind = "jump";
    },
  },
  {
    name: "return with successors",
    mutate: (graph) => {
      getRequired(graph.blocks, 0).terminal.kind = "return";
    },
  },
  {
    name: "unreachable block",
    mutate: (graph) => {
      graph.blocks.set(99, {
        id: 99,
        predecessors: [],
        phis: [],
        instructions: [],
        terminal: { kind: "return", value: null, edges: [] },
      });
    },
  },
];

it("accepts the unmodified validation control", () => verifySsa(getDiamond()));
it.each(invalid)("rejects malformed SSA: $name", ({ mutate }) => {
  const graph = getDiamond();
  mutate(graph);
  expect(() => verifySsa(graph)).toThrow(CompilerInvariantError);
});
