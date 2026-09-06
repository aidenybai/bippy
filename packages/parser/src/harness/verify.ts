import { formatMismatches, matchSnapshots, type Mismatch } from "../snapshot/match.js";
import { renderSnapshotTree } from "../snapshot/render.js";
import type { FiberSnapshot, NodeSnapshot } from "../snapshot/types.js";

export interface VerificationReport {
  isMatch: boolean;
  mismatches: Mismatch[];
  staticFiberCount: number;
  staticUnknownCount: number;
  runtimeFiberCount: number;
  staticTree: string;
  runtimeTree: string;
}

const countStatic = (nodes: NodeSnapshot[], totals: { fibers: number; unknowns: number }): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        totals.fibers++;
        countStatic(node.children, totals);
        if (node.fallback) countStatic(node.fallback, totals);
        break;
      case "branch":
        for (const alternative of node.alternatives) countStatic(alternative, totals);
        break;
      case "list":
        countStatic(node.items, totals);
        break;
      case "unknown":
        totals.unknowns++;
        break;
    }
  }
};

/** Compares a static snapshot against what React actually committed. */
export const verifySnapshots = (staticRoot: FiberSnapshot, runtimeRoot: FiberSnapshot): VerificationReport => {
  const result = matchSnapshots(staticRoot, runtimeRoot);
  const totals = { fibers: 0, unknowns: 0 };
  countStatic([staticRoot], totals);
  return {
    isMatch: result.isMatch,
    mismatches: result.mismatches,
    staticFiberCount: totals.fibers,
    staticUnknownCount: totals.unknowns,
    runtimeFiberCount: result.runtimeFiberCount,
    staticTree: renderSnapshotTree(staticRoot),
    runtimeTree: renderSnapshotTree(runtimeRoot),
  };
};

export const formatVerificationReport = (report: VerificationReport): string => {
  const summary = report.isMatch
    ? `match: ${report.staticFiberCount} static fibers (${report.staticUnknownCount} unknown) vs ${report.runtimeFiberCount} runtime fibers`
    : `mismatch: ${report.mismatches.length} problem(s)`;
  const sections = [summary];
  if (!report.isMatch) sections.push(formatMismatches(report.mismatches));
  sections.push(`static:\n${report.staticTree}`, `runtime:\n${report.runtimeTree}`);
  return sections.join("\n\n");
};
