import { CompilerInvariantError, getRequired, getReversePostorder, type SsaGraph } from "./ir.js";

export const verifySsa = (graph: SsaGraph): void => {
  const fail = (message: string): never => {
    throw new CompilerInvariantError(message);
  };
  const edges = new Set<number>();
  for (const [variableId, variable] of graph.variables)
    if (variable.id !== variableId) fail(`Invalid variable identity ${variableId}`);
  for (const [blockId, block] of graph.blocks) {
    if (block.id !== blockId) fail(`Invalid block identity ${blockId}`);
    if (blockId === graph.entry && block.predecessors.length) fail("Entry has predecessors");
    if (
      new Set(block.predecessors).size !== block.predecessors.length ||
      new Set(block.terminal.edges).size !== block.terminal.edges.length
    )
      fail(`Duplicate edge in block ${blockId}`);
    for (const edgeId of block.terminal.edges) {
      const edge = getRequired(graph.edges, edgeId);
      if (
        edge.id !== edgeId ||
        edge.from !== blockId ||
        !getRequired(graph.blocks, edge.to).predecessors.includes(edgeId)
      )
        fail(`Invalid outgoing edge ${edgeId}`);
      edges.add(edgeId);
    }
    for (const edgeId of block.predecessors) {
      const edge = getRequired(graph.edges, edgeId);
      if (
        edge.to !== blockId ||
        !getRequired(graph.blocks, edge.from).terminal.edges.includes(edgeId)
      )
        fail(`Invalid incoming edge ${edgeId}`);
    }
    const terminal = block.terminal;
    const kinds = terminal.edges.map((edgeId) => getRequired(graph.edges, edgeId).kind);
    if (terminal.kind === "branch") {
      if (
        terminal.value === null ||
        kinds.length !== 2 ||
        !(
          (kinds[0] === "truthy" && kinds[1] === "falsy") ||
          (kinds[0] === "nullish" && kinds[1] === "defined")
        )
      )
        fail(`Invalid branch in block ${blockId}`);
    } else if (terminal.kind === "invoke") {
      if (
        terminal.value === null ||
        (kinds[0] !== "normal" && kinds[0] !== "resume") ||
        kinds[1] !== "throw" ||
        (kinds.length !== 2 &&
          !(kinds.length === 3 && kinds[0] === "resume" && kinds[2] === "return"))
      )
        fail(`Invalid invocation in block ${blockId}`);
    } else if (kinds.length !== (terminal.kind === "jump" ? 1 : 0))
      fail(`Invalid successors in block ${blockId}`);
  }
  if (edges.size !== graph.edges.size) fail("Orphan SSA edges");
  const order = getReversePostorder(graph);
  if (order.length !== graph.blocks.size) fail("SSA contains unreachable blocks");
  const ranks = new Map(order.map((block, index) => [block, index]));
  const dominators = new Map<number, number>([[graph.entry, graph.entry]]);
  const intersect = (left: number, right: number): number => {
    while (left !== right) {
      while (getRequired(ranks, left) > getRequired(ranks, right))
        left = getRequired(dominators, left);
      while (getRequired(ranks, right) > getRequired(ranks, left))
        right = getRequired(dominators, right);
    }
    return left;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const blockId of order.slice(1)) {
      const predecessors = getRequired(graph.blocks, blockId)
        .predecessors.map((edge) => getRequired(graph.edges, edge).from)
        .filter((predecessor) => dominators.has(predecessor));
      if (predecessors.length === 0) continue;
      const parent = predecessors.reduce(intersect);
      if (dominators.get(blockId) !== parent) {
        dominators.set(blockId, parent);
        changed = true;
      }
    }
  }
  const positions = new Map<number, number>();
  const seen = new Set<number>();
  const instructionIds = new Set<number>();
  const define = (
    target: number,
    block: number,
    instruction: number | null,
    position: number,
  ): void => {
    if (seen.has(target)) fail(`SSA value ${target} has multiple definitions`);
    seen.add(target);
    const definition = getRequired(graph.definitions, target);
    if (
      definition.id !== target ||
      definition.block !== block ||
      definition.instruction !== instruction ||
      !graph.variables.has(definition.variable)
    )
      fail(`Invalid definition ${target}`);
    if (instruction !== null) {
      if (instructionIds.has(instruction)) fail(`Duplicate instruction ${instruction}`);
      instructionIds.add(instruction);
    }
    positions.set(target, position);
  };
  for (const block of graph.blocks.values()) {
    for (const phi of block.phis) {
      define(phi.target, block.id, null, -1);
      if (getRequired(graph.definitions, phi.target).variable !== phi.variable)
        fail(`Invalid phi variable ${phi.target}`);
      if (
        phi.operands.size !== block.predecessors.length ||
        !block.predecessors.every((edge) => phi.operands.has(edge))
      )
        fail(`Incomplete phi ${phi.target}`);
      if (!phi.operands.size) fail(`Empty phi ${phi.target}`);
    }
    block.instructions.forEach((instruction, position) =>
      define(instruction.target, block.id, instruction.id, position),
    );
  }
  if (seen.size !== graph.definitions.size) fail("Orphan SSA definitions");
  const use = (value: number, blockId: number, position: number): void => {
    const definition = getRequired(graph.definitions, value);
    let current = blockId;
    while (current !== definition.block && current !== graph.entry)
      current = getRequired(dominators, current);
    if (current !== definition.block)
      fail(`Definition ${value} does not dominate block ${blockId}`);
    if (definition.block === blockId && getRequired(positions, value) >= position)
      fail(`Value ${value} used before definition`);
  };
  for (const block of graph.blocks.values()) {
    for (const phi of block.phis) {
      for (const [edge, operand] of phi.operands)
        use(operand, getRequired(graph.edges, edge).from, Infinity);
    }
    block.instructions.forEach((instruction, position) =>
      instruction.operands.forEach((operand) => use(operand, block.id, position)),
    );
    if (block.terminal.value !== null) use(block.terminal.value, block.id, Infinity);
  }
};
