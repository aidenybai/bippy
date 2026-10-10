import type { CompilerError } from "../compiler-error.js";
import { analyseFunctions } from "../compiler-inference/analyse-functions.js";
import { dropManualMemoization } from "../compiler-inference/drop-manual-memoization.js";
import { inferMutationAliasingEffects } from "../compiler-inference/infer-mutation-aliasing-effects.js";
import { inferMutationAliasingRanges } from "../compiler-inference/infer-mutation-aliasing-ranges.js";
import { inferReactivePlaces } from "../compiler-inference/infer-reactive-places.js";
import { inlineImmediatelyInvokedFunctionExpressions } from "../compiler-inference/inline-immediately-invoked-function-expressions.js";
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
import { optimizePropsMethodCalls } from "../optimization/optimize-props-method-calls.js";
import { inferTypes } from "../type-inference/infer-types.js";
import { eliminateRedundantPhi } from "../ssa/eliminate-redundant-phi.js";
import { enterSSA } from "../ssa/enter-ssa.js";
import type { Result } from "../utils/result.js";
import type { ReactFunction } from "./program.js";

/**
 * Lowers one component or hook and runs the compiler's passes, up to and
 * including reactivity inference. The result is the SSA form our own
 * analysis passes read.
 */
export const runPipeline = (
  reactFunction: ReactFunction,
  scopes: ScopeManager,
): Result<HIRFunction, CompilerError> => {
  const environment = new Environment(
    scopes,
    reactFunction.fnType,
    "lint",
    validateEnvironmentConfig({}),
    findContextIdentifiers(reactFunction.node, scopes),
    reactFunction.node,
  );
  return lower(reactFunction.node, environment).map((hir) => {
    if (environment.enableDropManualMemoization) {
      dropManualMemoization(hir);
    }
    inlineImmediatelyInvokedFunctionExpressions(hir);
    mergeConsecutiveBlocks(hir);
    assertConsistentIdentifiers(hir);
    assertTerminalSuccessorsExist(hir);
    enterSSA(hir);
    eliminateRedundantPhi(hir);
    assertConsistentIdentifiers(hir);
    constantPropagation(hir);
    inferTypes(hir);
    optimizePropsMethodCalls(hir);
    analyseFunctions(hir);
    inferMutationAliasingEffects(hir);
    // Note: Has to come after infer reference effects because "dead" code may still affect inference
    deadCodeElimination(hir);
    inferMutationAliasingRanges(hir, { isFunctionExpression: false });
    inferReactivePlaces(hir);
    return hir;
  });
};
