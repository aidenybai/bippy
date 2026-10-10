/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/index.ts at b618bbb.

export { computeDominatorTree, computePostDominatorTree } from "./dominator.js";
export {
  Environment,
  validateEnvironmentConfig,
  type EnvironmentConfig,
  type Hook,
  type ReactFunctionType,
} from "./environment.js";
export { findContextIdentifiers } from "./find-context-identifiers.js";
export * from "./hir.js";
export {
  HIRBuilder,
  type Bindings,
  createTemporaryPlace,
  markInstructionIds,
  markPredecessors,
  removeUnnecessaryTryCatch,
  reversePostorderBlocks,
} from "./hir-builder.js";
export { mergeConsecutiveBlocks } from "./merge-consecutive-blocks.js";
export {
  ScopeManager,
  isReferencedIdentifier,
  type Binding,
  type BindingKind,
  type FunctionNode,
  type IdentifierNode,
  type Scope,
} from "./scope.js";
export {
  printFunction,
  printHIR,
  printIdentifier,
  printInstruction,
  printInstructionValue,
  printLValue,
  printManualMemoDependency,
  printMixedHIR,
  printPattern,
  printPhi,
  printPlace,
  printSourceLocation,
  printSourceLocationLine,
  printTerminal,
  printType,
  type Options,
} from "./print-hir.js";
export { assertConsistentIdentifiers } from "./assert-consistent-identifiers.js";
export {
  assertTerminalPredsExist,
  assertTerminalSuccessorsExist,
} from "./assert-terminal-blocks-exist.js";
