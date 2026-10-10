/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/AssertTerminalBlocksExist.ts at b618bbb.

import { CompilerError } from "../compiler-error.js";
import { GeneratedSource, type HIRFunction } from "./hir.js";
import { mapTerminalSuccessors } from "./visitors.js";

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
