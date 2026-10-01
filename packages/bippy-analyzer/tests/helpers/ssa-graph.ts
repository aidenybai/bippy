import type {
  ControlFlowGraph,
  FlowBlock,
  FlowEdge,
  FlowInstruction,
} from "../../src/compiler/ir.js";
import type { StaticPrimitive } from "../../src/types.js";

export interface GraphBuilder {
  graph: ControlFlowGraph;
  block: () => FlowBlock;
  emit: (
    block: FlowBlock,
    kind: FlowInstruction["kind"],
    target: number,
    operands?: number[],
    constant?: StaticPrimitive,
  ) => FlowInstruction;
  edge: (source: FlowBlock, target: FlowBlock, kind?: FlowEdge["kind"]) => number;
}

export const createGraph = (): GraphBuilder => {
  const graph: ControlFlowGraph = {
    entry: 0,
    blocks: new Map(),
    edges: new Map(),
    variables: new Map(),
  };
  let nextInstruction = 0;
  const define = (variable: number): void => {
    graph.variables.set(variable, { id: variable, name: `value${variable}`, storage: "local" });
  };
  return {
    graph,
    block: () => {
      const blockId = graph.blocks.size;
      const block: FlowBlock = {
        id: blockId,
        instructions: [],
        predecessors: [],
        terminal: { kind: "jump", value: null, edges: [] },
      };
      graph.blocks.set(blockId, block);
      return block;
    },
    emit: (block, kind, target, operands = [], constant) => {
      define(target);
      operands.forEach(define);
      const instruction: FlowInstruction = {
        id: nextInstruction++,
        kind,
        target,
        operands,
        constant,
        node: null,
      };
      block.instructions.push(instruction);
      return instruction;
    },
    edge: (source, target, kind = "normal") => {
      const edgeId = graph.edges.size;
      graph.edges.set(edgeId, { id: edgeId, from: source.id, to: target.id, kind });
      source.terminal.edges.push(edgeId);
      target.predecessors.push(edgeId);
      return edgeId;
    },
  };
};
