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
import { inferTypes } from "../type-inference/infer-types.js";
import { eliminateRedundantPhi } from "../ssa/eliminate-redundant-phi.js";
import { enterSSA } from "../ssa/enter-ssa.js";
import type { Result } from "../utils/result.js";
import type { ReactFunction } from "./program.js";

/**
 * Lowers one component or hook and runs the compiler's passes.
 * The result is the SSA form our own analysis passes read.
 */
export const runPipeline = (
  reactFunction: ReactFunction,
  scopes: ScopeManager,
): Result<HIRFunction, CompilerError> => {
  const environment = new Environment(
    scopes,
    reactFunction.fnType,
    validateEnvironmentConfig({}),
    findContextIdentifiers(reactFunction.node, scopes),
    reactFunction.node,
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
