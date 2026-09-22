import type { FunctionLikeNode } from "../parse/source-types.js";
import { eliminateRedundantPhis } from "./eliminate-phis.js";
import { enterSsa } from "./enter-ssa.js";
import { UnsupportedControlFlow, type ConstantAnalysis, type SsaGraph } from "./ir.js";
import { lowerFunction } from "./lower-function.js";
import { propagateConstants } from "./propagate-constants.js";
import { verifySsa } from "./verify-ssa.js";

export interface CompiledFunction {
  graph: SsaGraph;
  constants: ConstantAnalysis;
}

export interface CompilationResult {
  status: "compiled" | "unsupported";
  function: CompiledFunction | null;
  reason: string | null;
}

const cache = new WeakMap<FunctionLikeNode, CompilationResult>();

export const compileFunction = (node: FunctionLikeNode): CompilationResult => {
  const cached = cache.get(node);
  if (cached) return cached;
  let result: CompilationResult;
  try {
    const graph = enterSsa(lowerFunction(node));
    eliminateRedundantPhis(graph);
    verifySsa(graph);
    const constants = propagateConstants(graph);
    result = { status: "compiled", function: { graph, constants }, reason: null };
  } catch (error) {
    if (!(error instanceof UnsupportedControlFlow)) throw error;
    result = { status: "unsupported", function: null, reason: error.message };
  }
  cache.set(node, result);
  return result;
};
