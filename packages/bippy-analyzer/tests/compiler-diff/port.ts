import type { SourceFile } from "typescript/unstable/ast";
import type { Checker } from "typescript/unstable/sync";
import type { CompilerError } from "../../src/compiler/compiler-error.js";
import { analyseFunctions } from "../../src/compiler/inference/analyse-functions.js";
import { dropManualMemoization } from "../../src/compiler/inference/drop-manual-memoization.js";
import { inferMutationAliasingEffects } from "../../src/compiler/inference/infer-mutation-aliasing-effects.js";
import { inferMutationAliasingRanges } from "../../src/compiler/inference/infer-mutation-aliasing-ranges.js";
import { inferReactivePlaces } from "../../src/compiler/inference/infer-reactive-places.js";
import { inlineImmediatelyInvokedFunctionExpressions } from "../../src/compiler/inference/inline-immediately-invoked-function-expressions.js";
import { runPipeline } from "../../src/compiler/pipeline.js";
import type { ReactFunction } from "../../src/compiler/program.js";
import { assertConsistentIdentifiers } from "../../src/compiler/hir/assert-consistent-identifiers.js";
import { assertTerminalSuccessorsExist } from "../../src/compiler/hir/assert-terminal-blocks-exist.js";
import { lower } from "../../src/compiler/hir/build-hir.js";
import { Environment, validateEnvironmentConfig } from "../../src/compiler/hir/environment.js";
import { findContextIdentifiers } from "../../src/compiler/hir/find-context-identifiers.js";
import type { HIRFunction } from "../../src/compiler/hir/hir.js";
import { mergeConsecutiveBlocks } from "../../src/compiler/hir/merge-consecutive-blocks.js";
import type { ScopeManager } from "../../src/compiler/hir/scope.js";
import { constantPropagation } from "../../src/compiler/optimization/constant-propagation.js";
import { deadCodeElimination } from "../../src/compiler/optimization/dead-code-elimination.js";
import { optimizePropsMethodCalls } from "../../src/compiler/optimization/optimize-props-method-calls.js";
import { pruneMaybeThrows } from "../../src/compiler/optimization/prune-maybe-throws.js";
import { eliminateRedundantPhi } from "../../src/compiler/ssa/eliminate-redundant-phi.js";
import { enterSSA } from "../../src/compiler/ssa/enter-ssa.js";
import { inferTypes } from "../../src/compiler/type-inference/infer-types.js";
import type { Result } from "../../src/compiler/utils/result.js";

export interface PortContext {
  sourceFile: SourceFile;
  checker: Checker;
  scopes: ScopeManager;
}

/**
 * `runPipeline` without the TypeScript type provider, the one place our pipeline departs
 * from upstream on purpose. Keep the passes in sync with `src/compiler/pipeline.ts`.
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
