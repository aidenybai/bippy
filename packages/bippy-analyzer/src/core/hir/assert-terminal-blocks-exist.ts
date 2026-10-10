/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/AssertTerminalBlocksExist.ts at b618bbb.

import { CompilerError } from "../compiler-error.js";
import { GeneratedSource, type HIRFunction } from "./hir.js";
import { eachTerminalSuccessor, mapTerminalSuccessors } from "./visitors.js";

export const assertTerminalSuccessorsExist = (fn: HIRFunction): void => {
  for (const [, block] of fn.body.blocks) {
    mapTerminalSuccessors(block.terminal, (successor) => {
      CompilerError.invariant(fn.body.blocks.has(successor), {
        reason: `Terminal successor references unknown block`,
        description: `Block bb${successor} does not exist for terminal '${block.terminal.kind}' [${block.terminal.id}]`,
        loc: block.terminal.loc ?? GeneratedSource,
      });
      return successor;
    });
  }
};

export const assertTerminalPredsExist = (fn: HIRFunction): void => {
  for (const [, block] of fn.body.blocks) {
    for (const pred of block.preds) {
      const predBlock = fn.body.blocks.get(pred);
      CompilerError.invariant(predBlock !== undefined, {
        reason: "Expected predecessor block to exist",
        description: `Block ${block.id} references non-existent ${pred}`,
        loc: GeneratedSource,
      });
      CompilerError.invariant(eachTerminalSuccessor(predBlock.terminal).includes(block.id), {
        reason: "Terminal successor does not reference correct predecessor",
        description: `Block bb${block.id} has bb${predBlock.id} as a predecessor, but bb${predBlock.id}'s successors do not include bb${block.id}`,
        loc: GeneratedSource,
      });
    }
  }
};
