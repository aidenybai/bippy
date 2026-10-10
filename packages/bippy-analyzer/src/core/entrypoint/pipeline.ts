import type { SourceFile } from "typescript/unstable/ast";
import type { Checker } from "typescript/unstable/sync";
import type { CompilerError } from "../compiler-error.js";
import { assertConsistentIdentifiers } from "../hir/assert-consistent-identifiers.js";
import { assertTerminalSuccessorsExist } from "../hir/assert-terminal-blocks-exist.js";
import { lower } from "../hir/build-hir.js";
import { Environment, validateEnvironmentConfig } from "../hir/environment.js";
import { findContextIdentifiers } from "../hir/find-context-identifiers.js";
import type { HIRFunction } from "../hir/hir.js";
import { mergeConsecutiveBlocks } from "../hir/merge-consecutive-blocks.js";
import type { ScopeManager } from "../hir/scope.js";
import { constantPropagation } from "../optimization/constant-propagation.js";
import { deadCodeElimination } from "../optimization/dead-code-elimination.js";
import { eliminateRedundantPhi } from "../ssa/eliminate-redundant-phi.js";
import { enterSSA } from "../ssa/enter-ssa.js";
import { inferTypes } from "../type-inference/infer-types.js";
import type { Result } from "../utils/result.js";
import type { ReactFunction } from "./program.js";

export interface PipelineContext {
  scopes: ScopeManager;
  sourceFile: SourceFile;
  checker: Checker;
}

/**
 * Lowers one component or hook and runs the compiler's passes up to type inference.
 * The result is the SSA form our own analysis passes read.
 */
export const runPipeline = (
  reactFunction: ReactFunction,
  context: PipelineContext,
): Result<HIRFunction, CompilerError> => {
  const { scopes, sourceFile, checker } = context;
  const environment = new Environment(
    scopes,
    reactFunction.fnType,
    validateEnvironmentConfig({}),
    findContextIdentifiers(reactFunction.node, scopes),
    reactFunction.node,
    sourceFile,
    checker,
  );
  return lower(reactFunction.node, environment).map((hir) => {
    mergeConsecutiveBlocks(hir);
    assertConsistentIdentifiers(hir);
    assertTerminalSuccessorsExist(hir);
    enterSSA(hir);
    eliminateRedundantPhi(hir);
    assertConsistentIdentifiers(hir);
    constantPropagation(hir);
    inferTypes(hir);
    deadCodeElimination(hir);
    return hir;
  });
};
