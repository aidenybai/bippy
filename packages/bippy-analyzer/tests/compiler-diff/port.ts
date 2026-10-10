import type { SourceFile } from "typescript/unstable/ast";
import type { Checker } from "typescript/unstable/sync";
import type { CompilerError } from "../../src/core/compiler-error.js";
import { analyseFunctions } from "../../src/core/compiler-inference/analyse-functions.js";
import { dropManualMemoization } from "../../src/core/compiler-inference/drop-manual-memoization.js";
import { inferMutationAliasingEffects } from "../../src/core/compiler-inference/infer-mutation-aliasing-effects.js";
import { inferMutationAliasingRanges } from "../../src/core/compiler-inference/infer-mutation-aliasing-ranges.js";
import { inferReactivePlaces } from "../../src/core/compiler-inference/infer-reactive-places.js";
import { inlineImmediatelyInvokedFunctionExpressions } from "../../src/core/compiler-inference/inline-immediately-invoked-function-expressions.js";
import { runPipeline } from "../../src/core/entrypoint/pipeline.js";
import type { ReactFunction } from "../../src/core/entrypoint/program.js";
import { assertConsistentIdentifiers } from "../../src/core/hir/assert-consistent-identifiers.js";
import { assertTerminalSuccessorsExist } from "../../src/core/hir/assert-terminal-blocks-exist.js";
import { lower } from "../../src/core/hir/build-hir.js";
import { Environment, validateEnvironmentConfig } from "../../src/core/hir/environment.js";
import { findContextIdentifiers } from "../../src/core/hir/find-context-identifiers.js";
import type { HIRFunction } from "../../src/core/hir/hir.js";
import { mergeConsecutiveBlocks } from "../../src/core/hir/merge-consecutive-blocks.js";
import type { ScopeManager } from "../../src/core/hir/scope.js";
import { constantPropagation } from "../../src/core/optimization/constant-propagation.js";
import { deadCodeElimination } from "../../src/core/optimization/dead-code-elimination.js";
import { optimizePropsMethodCalls } from "../../src/core/optimization/optimize-props-method-calls.js";
import { pruneMaybeThrows } from "../../src/core/optimization/prune-maybe-throws.js";
import { eliminateRedundantPhi } from "../../src/core/ssa/eliminate-redundant-phi.js";
import { enterSSA } from "../../src/core/ssa/enter-ssa.js";
import { inferTypes } from "../../src/core/type-inference/infer-types.js";
import type { Result } from "../../src/core/utils/result.js";

export interface PortContext {
  sourceFile: SourceFile;
  checker: Checker;
  scopes: ScopeManager;
}

/**
 * `runPipeline` without the TypeScript type provider, the one place our pipeline departs
 * from upstream on purpose. Keep the passes in sync with `src/core/entrypoint/pipeline.ts`.
 */
const runUntypedPipeline = (
  reactFunction: ReactFunction,
  context: PortContext,
): Result<HIRFunction, CompilerError> => {
  const environment = new Environment(
    context.scopes,
    reactFunction.fnType,
    "lint",
    validateEnvironmentConfig({}),
    findContextIdentifiers(reactFunction.node, context.scopes),
    reactFunction.node,
    null,
  );
  return lower(reactFunction.node, environment).map((hir) => {
    pruneMaybeThrows(hir);
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
    deadCodeElimination(hir);
    pruneMaybeThrows(hir);
    inferMutationAliasingRanges(hir, { isFunctionExpression: false });
    inferReactivePlaces(hir);
    return hir;
  });
};

export const runPortPipeline = (
  reactFunction: ReactFunction,
  context: PortContext,
  isTypeProviderEnabled: boolean,
): Result<HIRFunction, CompilerError> =>
  isTypeProviderEnabled
    ? runPipeline(reactFunction, context)
    : runUntypedPipeline(reactFunction, context);
