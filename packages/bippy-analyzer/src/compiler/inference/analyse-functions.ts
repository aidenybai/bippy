/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/Inference/AnalyseFunctions.ts at b618bbb.

import { CompilerError } from "../compiler-error.js";
import { Effect, type HIRFunction, type IdentifierId, makeInstructionId } from "../hir/hir.js";
import { deadCodeElimination } from "../optimization/dead-code-elimination.js";
import { inferReactiveScopeVariables } from "../reactive-scopes/infer-reactive-scope-variables.js";
import { rewriteInstructionKindsBasedOnReassignment } from "../ssa/rewrite-instruction-kinds-based-on-reassignment.js";
import { assertExhaustive } from "../utils/utils.js";
import { inferMutationAliasingEffects } from "./infer-mutation-aliasing-effects.js";
import { inferMutationAliasingRanges } from "./infer-mutation-aliasing-ranges.js";

export const analyseFunctions = (func: HIRFunction): void => {
  for (const [, block] of func.body.blocks) {
    for (const instr of block.instructions) {
      switch (instr.value.kind) {
        case "ObjectMethod":
        case "FunctionExpression": {
          lowerWithMutationAliasing(instr.value.loweredFunc.func);

          /**
           * Reset mutable range for outer inferReferenceEffects
           */
          for (const operand of instr.value.loweredFunc.func.context) {
            /**
             * NOTE: inferReactiveScopeVariables makes identifiers in the scope
             * point to the *same* mutableRange instance. Resetting start/end
             * here is insufficient, because a later mutation of the range
             * for any one identifier could affect the range for other identifiers.
             */
            operand.identifier.mutableRange = {
              start: makeInstructionId(0),
              end: makeInstructionId(0),
            };
            operand.identifier.scope = null;
          }
          break;
        }
      }
    }
  }
};

const lowerWithMutationAliasing = (fn: HIRFunction): void => {
  /**
   * Phase 1: similar to lower(), but using the new mutation/aliasing inference
   */
  analyseFunctions(fn);
  inferMutationAliasingEffects(fn, { isFunctionExpression: true });
  deadCodeElimination(fn);
  const functionEffects = inferMutationAliasingRanges(fn, {
    isFunctionExpression: true,
  });
  rewriteInstructionKindsBasedOnReassignment(fn);
  inferReactiveScopeVariables(fn);
  fn.aliasingEffects = functionEffects;

  /**
   * Phase 2: populate the Effect of each context variable to use in inferring
   * the outer function. For example, InferMutationAliasingEffects uses context variable
   * effects to decide if the function may be mutable or not.
   */
  const capturedOrMutated = new Set<IdentifierId>();
  for (const effect of functionEffects) {
    switch (effect.kind) {
      case "Assign":
      case "Alias":
      case "Capture":
      case "CreateFrom":
      case "MaybeAlias": {
        capturedOrMutated.add(effect.from.identifier.id);
        break;
      }
      case "Apply": {
        CompilerError.invariant(false, {
          reason: `[AnalyzeFunctions] Expected Apply effects to be replaced with more precise effects`,
          loc: effect.function.loc,
        });
        break;
      }
      case "Mutate":
      case "MutateConditionally":
      case "MutateTransitive":
      case "MutateTransitiveConditionally": {
        capturedOrMutated.add(effect.value.identifier.id);
        break;
      }
      case "Impure":
      case "Render":
      case "MutateFrozen":
      case "MutateGlobal":
      case "CreateFunction":
      case "Create":
      case "Freeze":
      case "ImmutableCapture": {
        // no-op
        break;
      }
      default: {
        assertExhaustive(effect, "Unexpected effect kind");
      }
    }
  }

  for (const operand of fn.context) {
    if (capturedOrMutated.has(operand.identifier.id) || operand.effect === Effect.Capture) {
      operand.effect = Effect.Capture;
    } else {
      operand.effect = Effect.Read;
    }
  }
};
