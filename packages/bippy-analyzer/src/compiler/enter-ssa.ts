// Copyright (c) Meta Platforms, Inc. and affiliates.
// Adapted from React Compiler's sealed-block SSA construction.
// MIT license: ../../licenses/react-mit.txt. See ../../third-party-notices.md.
import {
  CompilerInvariantError,
  getRequired,
  getReversePostorder,
  type ControlFlowGraph,
  type SsaBlock,
  type SsaGraph,
  type SsaPhi,
} from "./ir.js";

interface BlockState {
  definitions: Map<number, number>;
  incomplete: SsaPhi[];
  sealed: boolean;
}

interface PendingPhi {
  phi: SsaPhi;
  block: SsaBlock;
}

export const enterSsa = (input: ControlFlowGraph): SsaGraph => {
  const order = getReversePostorder(input);
  const reachable = new Set(order);
  const graph: SsaGraph = {
    ...input,
    edges: new Map([...input.edges].filter(([, edge]) => reachable.has(edge.from))),
    blocks: new Map(),
    definitions: new Map(),
  };
  const states = new Map<number, BlockState>();
  for (const blockId of order) {
    const block = getRequired(input.blocks, blockId);
    graph.blocks.set(blockId, {
      ...block,
      instructions: [],
      predecessors: block.predecessors.filter((edge) => graph.edges.has(edge)),
      terminal: { ...block.terminal, edges: [...block.terminal.edges] },
      phis: [],
    });
    states.set(blockId, { definitions: new Map(), incomplete: [], sealed: false });
  }
  let nextValue = 0;
  const define = (variable: number, block: SsaBlock, instruction: number | null): number => {
    const valueId = nextValue++;
    graph.definitions.set(valueId, { id: valueId, variable, block: block.id, instruction });
    getRequired(states, block.id).definitions.set(variable, valueId);
    return valueId;
  };
  const createPhi = (variable: number, block: SsaBlock): SsaPhi => {
    const phi = {
      variable,
      target: define(variable, block, null),
      operands: new Map<number, number>(),
    };
    block.phis.push(phi);
    return phi;
  };
  const pending: PendingPhi[] = [];
  const read = (variable: number, blockId: number): number => {
    const path: BlockState[] = [];
    let current = blockId;
    let value: number;
    for (;;) {
      const state = getRequired(states, current);
      const existing = state.definitions.get(variable);
      if (existing !== undefined) {
        value = existing;
        break;
      }
      const block = getRequired(graph.blocks, current);
      if (!state.sealed) {
        const phi = createPhi(variable, block);
        state.incomplete.push(phi);
        value = phi.target;
        break;
      }
      if (block.predecessors.length === 0)
        throw new CompilerInvariantError(`Variable ${variable} is undefined at entry`);
      if (block.predecessors.length === 1) {
        path.push(state);
        current = getRequired(graph.edges, block.predecessors[0]).from;
      } else {
        const phi = createPhi(variable, block);
        pending.push({ phi, block });
        value = phi.target;
        break;
      }
    }
    for (const state of path) state.definitions.set(variable, value);
    return value;
  };
  const seal = (block: SsaBlock): void => {
    const state = getRequired(states, block.id);
    if (state.sealed) return;
    state.sealed = true;
    for (const phi of state.incomplete) pending.push({ phi, block });
    state.incomplete.length = 0;
  };
  const visited = new Set<number>();
  for (const blockId of order) {
    const block = getRequired(graph.blocks, blockId);
    if (block.predecessors.every((edge) => visited.has(getRequired(graph.edges, edge).from)))
      seal(block);
    for (const instruction of getRequired(input.blocks, blockId).instructions) {
      const operands = instruction.operands.map((variable) => read(variable, blockId));
      const target = define(instruction.target, block, instruction.id);
      block.instructions.push({ ...instruction, target, operands });
    }
    if (block.terminal.value !== null) block.terminal.value = read(block.terminal.value, blockId);
    visited.add(blockId);
    for (const edgeId of block.terminal.edges) {
      const successor = getRequired(graph.blocks, getRequired(graph.edges, edgeId).to);
      if (successor.predecessors.every((edge) => visited.has(getRequired(graph.edges, edge).from)))
        seal(successor);
    }
  }
  for (const block of graph.blocks.values()) seal(block);
  for (let index = 0; index < pending.length; index++) {
    const { phi, block } = pending[index];
    for (const edgeId of block.predecessors)
      phi.operands.set(edgeId, read(phi.variable, getRequired(graph.edges, edgeId).from));
  }
  return graph;
};
