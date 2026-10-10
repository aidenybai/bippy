import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";
import { predecessorBlocks, successorBlocks } from "./block-edges.js";
import { reversePostorder } from "./reverse-postorder.js";

export interface DominatorTree {
  // Blocks reachable from the tree's root (entry for dominators, exit for
  // post-dominators). Queries outside this set return false.
  readonly reachable: ReadonlySet<BasicBlock>;
  // The immediate dominator of `block` (the root maps to itself); null if
  // `block` is unreachable from the root.
  readonly immediateDominatorOf: (block: BasicBlock) => BasicBlock | null;
  // `ancestor` dominates `node`: it lies on `node`'s idom chain (a node
  // dominates itself). For a post-dominator tree this reads as "`ancestor`
  // post-dominates `node`".
  readonly dominates: (ancestor: BasicBlock, node: BasicBlock) => boolean;
  // The dominance frontier of `block` (Cytron et al.): the blocks where
  // `block`'s dominance stops. The SSA-construction seam; no consumer uses
  // it yet, but it is a cheap, high-fidelity parity artifact.
  readonly dominanceFrontierOf: (block: BasicBlock) => ReadonlySet<BasicBlock>;
}

// Cooper–Harvey–Kennedy "A Simple, Fast Dominance Algorithm": iterate the
// idom array over reverse-postorder until it stabilizes. `successorsOf`
// drives the RPO walk from `root`; `predecessorsOf` feeds the intersection
// step. For a post-dominator tree, callers pass the reversed relations
// (root = exit, successors = CFG predecessors, predecessors = CFG
// successors). Same algorithm the React Compiler uses (`Dominator.ts`).
const buildDominatorTree = (
  root: BasicBlock,
  successorsOf: (block: BasicBlock) => ReadonlyArray<BasicBlock>,
  predecessorsOf: (block: BasicBlock) => ReadonlyArray<BasicBlock>,
): DominatorTree => {
  const order = reversePostorder(root, successorsOf);
  const rpoNumber = new Map<BasicBlock, number>();
  order.forEach((block, index) => rpoNumber.set(block, index));

  const idom = new Map<BasicBlock, BasicBlock | null>();
  for (const block of order) idom.set(block, null);
  idom.set(root, root);

  // Walk both fingers up the partially-built tree until they meet — the
  // nearest common dominator of two already-processed blocks.
  const intersect = (left: BasicBlock, right: BasicBlock): BasicBlock => {
    let finger1 = left;
    let finger2 = right;
    while (finger1 !== finger2) {
      while (rpoNumber.get(finger1)! > rpoNumber.get(finger2)!) finger1 = idom.get(finger1)!;
      while (rpoNumber.get(finger2)! > rpoNumber.get(finger1)!) finger2 = idom.get(finger2)!;
    }
    return finger1;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const block of order) {
      if (block === root) continue;
      let newIdom: BasicBlock | null = null;
      for (const predecessor of predecessorsOf(block)) {
        // Skip predecessors not yet processed (undefined) or unreachable from
        // root (null) — dead code can't influence runtime dominance.
        if ((idom.get(predecessor) ?? null) === null) continue;
        newIdom = newIdom === null ? predecessor : intersect(predecessor, newIdom);
      }
      if (newIdom !== null && idom.get(block) !== newIdom) {
        idom.set(block, newIdom);
        changed = true;
      }
    }
  }

  const reachable = new Set(order);

  const dominates = (ancestor: BasicBlock, node: BasicBlock): boolean => {
    if (!reachable.has(ancestor) || !reachable.has(node)) return false;
    let current: BasicBlock | null = node;
    while (current !== null) {
      if (current === ancestor) return true;
      const next: BasicBlock | null = idom.get(current) ?? null;
      if (next === current) return false; // reached the root
      current = next;
    }
    return false;
  };

  // Cytron et al.: for every join block (≥2 reachable predecessors), each
  // predecessor `runner` adds the join to its dominance frontier until it
  // hits the join's immediate dominator.
  const dominanceFrontier = new Map<BasicBlock, Set<BasicBlock>>();
  for (const block of order) dominanceFrontier.set(block, new Set());
  for (const block of order) {
    const predecessors = predecessorsOf(block).filter((predecessor) => reachable.has(predecessor));
    if (predecessors.length < 2) continue;
    const blockIdom = idom.get(block);
    for (const predecessor of predecessors) {
      let runner: BasicBlock | null = predecessor;
      while (runner !== null && runner !== blockIdom) {
        dominanceFrontier.get(runner)!.add(block);
        const next: BasicBlock | null = idom.get(runner) ?? null;
        if (next === runner) break;
        runner = next;
      }
    }
  }

  const emptyFrontier: ReadonlySet<BasicBlock> = new Set();

  return {
    reachable,
    immediateDominatorOf: (block) => idom.get(block) ?? null,
    dominates,
    dominanceFrontierOf: (block) => dominanceFrontier.get(block) ?? emptyFrontier,
  };
};

// Forward dominator tree rooted at the function entry.
export const computeDominatorTree = (entry: BasicBlock): DominatorTree =>
  buildDominatorTree(entry, successorBlocks, predecessorBlocks);

// Post-dominator tree: the dominator tree of the reversed graph rooted at
// the function exit. `tree.dominates(a, b)` then means "a post-dominates b".
export const computePostDominatorTree = (exit: BasicBlock): DominatorTree =>
  buildDominatorTree(exit, predecessorBlocks, successorBlocks);

// Post-dominator tree that stays well-defined inside infinite loops. A block in
// an exit-less loop (`while (true)`, `for (;;)` with no break) can't reach the
// exit, so the plain reverse traversal never visits it: it drops out of the tree
// and looks control-dependent on nothing, which collapses guard depth to 0 for
// everything nested in the loop. We give each infinite-loop latch (a back-edge
// source that can't reach the exit) a virtual edge to the exit — the same
// completion `computeUnconditionalSet` uses — so post-dominance is defined for
// those blocks. When the exit is reachable there are no such latches and this is
// exactly `computePostDominatorTree`, so finite-loop code is unaffected.
export const computePostDominatorTreeWithVirtualExits = (cfg: FunctionCfg): DominatorTree => {
  const reachesExit = new Set<BasicBlock>([cfg.exit]);
  const queue: BasicBlock[] = [cfg.exit];
  let head = 0;
  while (head < queue.length) {
    const block = queue[head++]!;
    for (const edge of block.predecessors) {
      if (edge.kind === "throw") continue;
      if (!reachesExit.has(edge.from)) {
        reachesExit.add(edge.from);
        queue.push(edge.from);
      }
    }
  }

  const latches: BasicBlock[] = [];
  for (const block of cfg.blocks) {
    if (reachesExit.has(block)) continue;
    if (block.successors.some((edge) => edge.kind === "backedge")) latches.push(block);
  }
  if (latches.length === 0) return computePostDominatorTree(cfg.exit);

  const latchSet = new Set(latches);
  // Reversed-graph relations with the virtual `latch -> exit` edges folded in:
  // the exit gains the latches as reverse-successors, each latch gains the exit
  // as a reverse-predecessor.
  const reverseSuccessors = (block: BasicBlock): ReadonlyArray<BasicBlock> =>
    block === cfg.exit ? [...predecessorBlocks(block), ...latches] : predecessorBlocks(block);
  const reversePredecessors = (block: BasicBlock): ReadonlyArray<BasicBlock> =>
    latchSet.has(block) ? [...successorBlocks(block), cfg.exit] : successorBlocks(block);
  return buildDominatorTree(cfg.exit, reverseSuccessors, reversePredecessors);
};
