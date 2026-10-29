import type { HIRFunction } from "../../react-compiler/HIR/HIR";
import { memoizeByIdentity } from "../shared/memoize-by-identity";

export interface MemoRange {
  start: number;
  finish: number;
}

export const getMemoRanges = memoizeByIdentity((hirFunction: HIRFunction): MemoRange[] => {
  const starts = new Map<number, number>();
  const ranges: MemoRange[] = [];
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions) {
      const { value } = instruction;
      if (value.kind === "StartMemoize") starts.set(value.manualMemoId, instruction.id);
      const start = value.kind === "FinishMemoize" ? starts.get(value.manualMemoId) : undefined;
      if (start !== undefined) ranges.push({ start, finish: instruction.id });
    }
  return ranges;
});
