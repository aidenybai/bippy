/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/Dominator.ts at b618bbb.

import { CompilerError } from "../compiler-error.js";
import { type BlockId, GeneratedSource, type HIRFunction } from "./hir.js";
import { eachTerminalSuccessor } from "./visitors.js";

/*
 * Computes the dominator tree of the given function. The returned `Dominator` stores the immediate
 * dominator of each node in the function, which can be retrieved with `Dominator.prototype.get()`.
 *
 * A block X dominates block Y in the CFG if all paths to Y must flow through X. Thus the entry
 * block dominates all other blocks. See https://en.wikipedia.org/wiki/Dominator_(graph_theory)
 * for more.
 */
export const computeDominatorTree = (func: HIRFunction): Dominator<BlockId> => {
  const graph = buildGraph(func);
  const nodes = computeImmediateDominators(graph);
  return new Dominator(graph.entry, nodes);
};

/*
 * Similar to `computeDominatorTree()` but computes the post dominators of the function. The returned
 * `PostDominator` stores the immediate post-dominators of each node in the function.
 *
 * A block Y post-dominates block X in the CFG if all paths from X to the exit must flow through Y.
 * The caller must specify whether to consider `throw` statements as exit nodes. If set to false,
 * only return statements are considered exit nodes.
 */
export const computePostDominatorTree = (
  func: HIRFunction,
  options: { includeThrowsAsExitNode: boolean },
): PostDominator<BlockId> => {
  const graph = buildReverseGraph(func, options.includeThrowsAsExitNode);
  const nodes = computeImmediateDominators(graph);

  /*
   * When options.includeThrowsAsExitNode is false, nodes that flow into a throws
   * terminal and don't reach the exit node won't be in the node map. Add them
   * with themselves as dominator to reflect that they don't flow into the exit.
   */
  if (!options.includeThrowsAsExitNode) {
    for (const [nodeId] of func.body.blocks) {
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, nodeId);
      }
    }
  }
  return new PostDominator(graph.entry, nodes);
};

interface Node<T> {
  id: T;
  index: number;
  preds: Set<T>;
  succs: Set<T>;
}
interface Graph<T> {
  entry: T;
  nodes: Map<T, Node<T>>;
}

// A dominator tree that stores the immediate dominator for each block in function.
export class Dominator<T> {
  #entry: T;
  #nodes: Map<T, T>;

  constructor(entry: T, nodes: Map<T, T>) {
    this.#entry = entry;
    this.#nodes = nodes;
  }

  // Returns the entry node
  get entry(): T {
    return this.#entry;
  }

  /*
   * Returns the immediate dominator of the block with @param nodeId if present. Returns null
   * if there is no immediate dominator (ie if the dominator is @param nodeId itself).
   */
  get(nodeId: T): T | null {
    const dominator = this.#nodes.get(nodeId);
    CompilerError.invariant(dominator !== undefined, {
      reason: "Unknown node",
      loc: GeneratedSource,
    });
    return dominator === nodeId ? null : dominator;
  }

  debug(): string {
    const dominators: Record<string, string> = {};
    for (const [key, value] of this.#nodes) {
      dominators[`bb${key}`] = `bb${value}`;
    }
    return JSON.stringify({ entry: `bb${this.#entry}`, dominators }, null, 2);
  }
}

export class PostDominator<T> {
  #exit: T;
  #nodes: Map<T, T>;

  constructor(exit: T, nodes: Map<T, T>) {
    this.#exit = exit;
    this.#nodes = nodes;
  }

  // Returns the node representing normal exit from the function, ie return terminals.
  get exit(): T {
    return this.#exit;
  }

  /*
   * Returns the immediate dominator of the block with @param nodeId if present. Returns null
   * if there is no immediate dominator (ie if the dominator is @param nodeId itself).
   */
  get(nodeId: T): T | null {
    const dominator = this.#nodes.get(nodeId);
    CompilerError.invariant(dominator !== undefined, {
      reason: "Unknown node",
      loc: GeneratedSource,
    });
    return dominator === nodeId ? null : dominator;
  }

  debug(): string {
    const postDominators: Record<string, string> = {};
    for (const [key, value] of this.#nodes) {
      postDominators[`bb${key}`] = `bb${value}`;
    }
    return JSON.stringify({ exit: `bb${this.exit}`, postDominators }, null, 2);
  }
}

/*
 * The implementation is a straightforward adaptation of https://www.cs.rice.edu/~keith/Embed/dom.pdf
 * except that CFG nodes ordering is inverted (so the comparison functions are swapped)
 */
const computeImmediateDominators = <T>(graph: Graph<T>): Map<T, T> => {
  const nodes: Map<T, T> = new Map();
  nodes.set(graph.entry, graph.entry);
  let isChanged = true;
  while (isChanged) {
    isChanged = false;
    for (const [nodeId, node] of graph.nodes) {
      // Skip start node
      if (node.id === graph.entry) {
        continue;
      }

      // first processed predecessor
      let newIdom: T | null = null;
      for (const pred of node.preds) {
        if (nodes.has(pred)) {
          newIdom = pred;
          break;
        }
      }
      CompilerError.invariant(newIdom !== null, {
        reason: `At least one predecessor must have been visited for block ${nodeId}`,
        loc: GeneratedSource,
      });

      for (const pred of node.preds) {
        // For all other predecessors
        if (pred === newIdom) {
          continue;
        }
        const predDom = nodes.get(pred);
        if (predDom !== undefined) {
          newIdom = intersect(pred, newIdom, graph, nodes);
        }
      }

      if (nodes.get(nodeId) !== newIdom) {
        nodes.set(nodeId, newIdom);
        isChanged = true;
      }
    }
  }
  return nodes;
};

const intersect = <T>(nodeA: T, nodeB: T, graph: Graph<T>, nodes: Map<T, T>): T => {
  const getNode = (nodeId: T): Node<T> => {
    const node = graph.nodes.get(nodeId);
    CompilerError.invariant(node !== undefined, {
      reason: "Unknown node",
      loc: GeneratedSource,
    });
    return node;
  };
  const getDominatorNode = (node: Node<T>): Node<T> => {
    const dominator = nodes.get(node.id);
    CompilerError.invariant(dominator !== undefined, {
      reason: "Unknown node",
      loc: GeneratedSource,
    });
    return getNode(dominator);
  };
  let block1 = getNode(nodeA);
  let block2 = getNode(nodeB);
  while (block1 !== block2) {
    while (block1.index > block2.index) {
      block1 = getDominatorNode(block1);
    }
    while (block2.index > block1.index) {
      block2 = getDominatorNode(block2);
    }
  }
  return block1.id;
};

// Turns the HIRFunction into a simplified internal form that is shared for dominator/post-dominator computation
const buildGraph = (func: HIRFunction): Graph<BlockId> => {
  const graph: Graph<BlockId> = { entry: func.body.entry, nodes: new Map() };
  let index = 0;
  for (const [nodeId, block] of func.body.blocks) {
    graph.nodes.set(nodeId, {
      id: nodeId,
      index: index++,
      preds: block.preds,
      succs: new Set(eachTerminalSuccessor(block.terminal)),
    });
  }
  return graph;
};

/*
 *  Turns the HIRFunction into a simplified internal form that is shared for dominator/post-dominator computation,
 * notably this version flips the graph and puts the reversed form back into RPO (such that successors are before predecessors).
 * Note that RPO of the reversed graph isn't the same as reversed RPO of the forward graph because of loops.
 */
const buildReverseGraph = (func: HIRFunction, includeThrowsAsExitNode: boolean): Graph<BlockId> => {
  const nodes: Map<BlockId, Node<BlockId>> = new Map();
  const exitId = func.env.nextBlockId;
  const exit: Node<BlockId> = {
    id: exitId,
    index: 0,
    preds: new Set(),
    succs: new Set(),
  };
  nodes.set(exitId, exit);

  for (const [nodeId, block] of func.body.blocks) {
    const node: Node<BlockId> = {
      id: nodeId,
      index: 0,
      preds: new Set(eachTerminalSuccessor(block.terminal)),
      succs: new Set(block.preds),
    };
    if (block.terminal.kind === "return") {
      node.preds.add(exitId);
      exit.succs.add(nodeId);
    } else if (block.terminal.kind === "throw" && includeThrowsAsExitNode) {
      node.preds.add(exitId);
      exit.succs.add(nodeId);
    }
    nodes.set(nodeId, node);
  }

  // Put nodes into RPO form
  const visited = new Set<BlockId>();
  const postorder: Array<BlockId> = [];
  const visit = (nodeId: BlockId): void => {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    for (const successor of nodes.get(nodeId)?.succs ?? []) {
      visit(successor);
    }
    postorder.push(nodeId);
  };
  visit(exitId);

  const rpo: Graph<BlockId> = { entry: exitId, nodes: new Map() };
  let index = 0;
  for (const nodeId of postorder.reverse()) {
    const node = nodes.get(nodeId);
    if (node === undefined) {
      continue;
    }
    node.index = index++;
    rpo.nodes.set(nodeId, node);
  }
  return rpo;
};
