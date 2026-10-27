import type { HIRFunction } from "../../react-compiler/HIR/HIR";
import { memoizeByIdentity } from "./memoize-by-identity";

const LOOP_KINDS = new Set(["for", "for-of", "for-in", "while", "do-while"]);

export const hasLoop = memoizeByIdentity((hirFunction: HIRFunction): boolean =>
  [...hirFunction.body.blocks.values()].some((block) => LOOP_KINDS.has(block.terminal.kind)),
);
