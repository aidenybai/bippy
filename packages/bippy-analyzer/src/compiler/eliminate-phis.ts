// Copyright (c) Meta Platforms, Inc. and affiliates.
// Adapted from React Compiler's phi rewriting, extended to phi SCCs.
// MIT license: ../../licenses/react-mit.txt. See ../../third-party-notices.md.
import type { SsaGraph, SsaPhi } from "./ir.js";

interface PhiVisit {
  target: number;
  operands: Iterator<number>;
}

export const eliminateRedundantPhis = (graph: SsaGraph): Map<number, number> => {
  const rewrites = new Map<number, number>();
  const resolve = (value: number): number => {
    const path: number[] = [];
    let current = value;
    while (rewrites.has(current)) {
      path.push(current);
      current = rewrites.get(current)!;
    }
    for (const previous of path) rewrites.set(previous, current);
    return current;
  };
  let changed = true;
  while (changed) {
    changed = false;
    const phis = new Map<number, SsaPhi>();
    for (const block of graph.blocks.values()) {
      for (const phi of block.phis) {
        if (rewrites.has(phi.target)) continue;
        const operands = new Set([...phi.operands.values()].map(resolve));
        operands.delete(phi.target);
        if (operands.size === 1) {
          rewrites.set(phi.target, operands.values().next().value!);
          changed = true;
        } else phis.set(phi.target, phi);
      }
    }
    if (changed) continue;
    const indices = new Map<number, number>();
    const lowLinks = new Map<number, number>();
    const stack: number[] = [];
    const active = new Set<number>();
    const visits: PhiVisit[] = [];
    const enter = (target: number): void => {
      const index = indices.size;
      indices.set(target, index);
      lowLinks.set(target, index);
      stack.push(target);
      active.add(target);
      visits.push({ target, operands: phis.get(target)!.operands.values() });
    };
    for (const root of phis.keys()) {
      if (indices.has(root)) continue;
      enter(root);
      while (visits.length) {
        const frame = visits[visits.length - 1];
        const next = frame.operands.next();
        if (!next.done) {
          const operand = resolve(next.value);
          if (!phis.has(operand)) continue;
          if (!indices.has(operand)) enter(operand);
          else if (active.has(operand))
            lowLinks.set(
              frame.target,
              Math.min(lowLinks.get(frame.target)!, indices.get(operand)!),
            );
          continue;
        }
        visits.pop();
        const parent = visits[visits.length - 1];
        if (parent)
          lowLinks.set(
            parent.target,
            Math.min(lowLinks.get(parent.target)!, lowLinks.get(frame.target)!),
          );
        if (lowLinks.get(frame.target) !== indices.get(frame.target)) continue;
        const component = new Set<number>();
        let member: number;
        do {
          member = stack.pop()!;
          active.delete(member);
          component.add(member);
        } while (member !== frame.target);
        const external = new Set<number>();
        for (const memberId of component) {
          for (const operand of phis.get(memberId)!.operands.values()) {
            const resolved = resolve(operand);
            if (!component.has(resolved)) external.add(resolved);
          }
        }
        if (external.size === 1) {
          const replacement = external.values().next().value!;
          for (const memberId of component) rewrites.set(memberId, replacement);
          changed = true;
        }
      }
    }
  }
  for (const block of graph.blocks.values()) {
    block.phis = block.phis.filter((phi) => !rewrites.has(phi.target));
    for (const phi of block.phis) {
      for (const [edge, operand] of phi.operands) phi.operands.set(edge, resolve(operand));
    }
    for (const instruction of block.instructions)
      instruction.operands = instruction.operands.map(resolve);
    if (block.terminal.value !== null) block.terminal.value = resolve(block.terminal.value);
  }
  for (const target of rewrites.keys()) {
    resolve(target);
    graph.definitions.delete(target);
  }
  return rewrites;
};
