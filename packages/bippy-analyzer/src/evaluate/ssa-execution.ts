import type { Node } from "oxc-parser";
import type { FunctionLikeNode, SourceLocation } from "../parse/source-types.js";
import { getSourceLocation } from "../parse/source-location.js";
import type { StaticValue } from "../types.js";
import { compileFunction, hasCompilation } from "../compiler/compile-function.js";
import { getRequired, type FlowInstruction, type SsaGraph } from "../compiler/ir.js";
import type { EvaluationContext } from "./context.js";
import {
  getSsaProfile,
  recordSsaAttempt,
  type SsaCompilationSample,
  type SsaFallback,
} from "./ssa-profile.js";
import { createErrorValue, getErrorWitness } from "./errors.js";
import { applyBinaryOperator, applyUnaryOperator } from "./operators.js";
import { getPresencePredicate, getTruthinessPredicate } from "./predicates.js";
import { lookupScope } from "./scope.js";
import { MAX_UNROLLED_ITERATIONS } from "./loops.js";
import { getThrowCertainty } from "./thrown.js";
import {
  getTruthiness,
  getObjectProperty,
  isNullish,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

export interface SsaExecutionHost {
  getTypeof: (value: StaticValue) => StaticValue;
  resolve: (value: StaticValue) => StaticValue;
  fork: (predicate: string, paths: Array<() => StaticValue>) => StaticValue;
  distribute: (value: StaticValue, run: (value: StaticValue) => StaticValue) => StaticValue;
  consumeStep: () => boolean;
}

export interface SsaBlocker {
  category: SsaFallback["category"];
  reason: string;
  node: Node | null;
}

interface SsaAttempt {
  value: StaticValue | null;
  blocker: SsaBlocker | null;
  compilation: SsaCompilationSample | null;
}

class SsaDeoptimization extends Error {
  constructor(readonly blocker: SsaBlocker) {
    super(blocker.reason);
  }
}

interface ExecutionState {
  values: Map<number, StaticValue>;
  uninitialized: Set<number>;
  visits: Map<number, number>;
  exception: StaticValue | null;
}

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
const GLOBAL_CONSTANTS = new Map<string, StaticValue>([
  ["undefined", UNDEFINED_VALUE],
  ["NaN", primitiveValue(NaN)],
  ["Infinity", primitiveValue(Infinity)],
]);
const isNaNValue = (value: StaticValue): boolean =>
  value.kind === "primitive" && typeof value.value === "number" && Number.isNaN(value.value);

const isScalar = (value: StaticValue): boolean =>
  value.kind === "primitive" ||
  value.kind === "unknown-primitive" ||
  (value.kind === "branch" && value.alternatives.every(isScalar));

const getSignatureBlockers = (node: FunctionLikeNode): SsaBlocker[] => {
  if (node.async) return [{ category: "static", reason: "async function", node }];
  if (node.type !== "ArrowFunctionExpression" && node.generator)
    return [{ category: "static", reason: "generator function", node }];
  return node.params
    .filter((parameter) => parameter.type !== "Identifier")
    .map((parameter) => ({
      category: "static",
      reason: `${parameter.type} parameter`,
      node: parameter,
    }));
};

const getInputBlocker = (
  value: StaticValue | undefined,
  role: string,
  node: Node,
): SsaBlocker | null =>
  value && isScalar(value)
    ? null
    : { category: "input", reason: `${value?.kind ?? "unbound"} ${role}`, node };

const getInstructionBlocker = (
  instruction: FlowInstruction,
  graph: SsaGraph,
  root: FunctionLikeNode,
): SsaBlocker | null => {
  const blocker = (reason: string): SsaBlocker => ({
    category: "static",
    reason,
    node: instruction.node,
  });
  if (instruction.kind === "load-cell" || instruction.kind === "store-cell")
    return blocker("captured binding");
  if (instruction.kind === "binary" && instruction.operator === "in") return blocker("in operator");
  if (instruction.kind === "input" && instruction.node) {
    const input = instruction.node;
    if (input.type === "CatchClause") return null;
    if (input.type === "Identifier" && root.params.some((parameter) => parameter === input))
      return null;
    const variable = getRequired(
      graph.variables,
      getRequired(graph.definitions, instruction.target).variable,
    );
    if (variable.storage === "cell") return blocker("captured binding");
    return blocker(input.type === "Identifier" ? "function self-reference" : input.type);
  }
  if (instruction.kind !== "opaque") return null;
  if (instruction.operator === "invalid-assignment") return null;
  if (
    instruction.operator === "load-reference" &&
    instruction.node?.type === "MemberExpression" &&
    !instruction.node.computed &&
    instruction.node.property.type === "Identifier" &&
    (instruction.node.property.name === "name" || instruction.node.property.name === "message")
  )
    return null;
  if (getExternalName(instruction) !== null) return null;
  return blocker(instruction.operator ?? "opaque operation");
};

const getExternalName = (instruction: FlowInstruction): string | null => {
  const external = instruction.node;
  if (instruction.kind === "input" || instruction.operator === "load-external")
    return external?.type === "Identifier" ? external.name : null;
  if (
    instruction.operator === "typeof-external" &&
    external?.type === "UnaryExpression" &&
    external.argument.type === "Identifier"
  )
    return external.argument.name;
  return null;
};

export const getStaticSsaBlockers = (node: FunctionLikeNode): SsaBlocker[] => {
  const blockers = getSignatureBlockers(node);
  const compiled = compileFunction(node);
  if (!compiled.function)
    return [...blockers, { category: "static", reason: `unsupported ${compiled.reason}`, node }];
  const { graph, constants } = compiled.function;
  for (const block of graph.blocks.values()) {
    if (!constants.executableBlocks.has(block.id)) continue;
    for (const instruction of block.instructions) {
      const blocker = getInstructionBlocker(instruction, graph, node);
      if (blocker) blockers.push(blocker);
    }
  }
  return blockers;
};

const getCompilationSample = (graph: SsaGraph, milliseconds: number): SsaCompilationSample => {
  const blocks = [...graph.blocks.values()];
  return {
    milliseconds,
    blocks: blocks.length,
    instructions: blocks.reduce((count, block) => count + block.instructions.length, 0),
    phis: blocks.reduce((count, block) => count + block.phis.length, 0),
  };
};

const attemptSsa = (
  node: FunctionLikeNode,
  context: EvaluationContext,
  host: SsaExecutionHost,
  location: SourceLocation | null,
  isProfiling: boolean,
): SsaAttempt => {
  const decline = (blocker: SsaBlocker, compilation: SsaCompilationSample | null = null) => ({
    value: null,
    blocker,
    compilation,
  });
  const signatureBlocker = getSignatureBlockers(node)[0];
  if (signatureBlocker) return decline(signatureBlocker);
  for (const parameter of node.params) {
    if (parameter.type !== "Identifier") continue;
    const blocker = getInputBlocker(
      lookupScope(context.scope, parameter.name),
      "parameter",
      parameter,
    );
    if (blocker) return decline(blocker);
  }
  const isCold = isProfiling && !hasCompilation(node);
  const compilationStartedAt = isCold ? performance.now() : 0;
  const compilation = compileFunction(node);
  const compiled = compilation.function;
  const sample =
    isCold && compiled
      ? getCompilationSample(compiled.graph, performance.now() - compilationStartedAt)
      : null;
  if (!compiled)
    return decline({ category: "static", reason: `unsupported ${compilation.reason}`, node });
  const graph = compiled.graph;
  const ranks = new Map([...graph.blocks.keys()].map((block, index) => [block, index]));
  const inputs = new Map<number, StaticValue>();
  const instructions = new Map<number, FlowInstruction>();
  for (const block of graph.blocks.values()) {
    for (const instruction of block.instructions) {
      instructions.set(instruction.target, instruction);
      if (!compiled.constants.executableBlocks.has(block.id)) continue;
      const staticBlocker = getInstructionBlocker(instruction, graph, node);
      if (staticBlocker) return decline(staticBlocker, sample);
      const name = getExternalName(instruction);
      if (name === null || !instruction.node) continue;
      const value = lookupScope(context.scope, name) ?? GLOBAL_CONSTANTS.get(name);
      const inputBlocker = getInputBlocker(
        value,
        instruction.kind === "input" ? "parameter" : "outer binding",
        instruction.node,
      );
      if (inputBlocker) return decline(inputBlocker, sample);
      if (value)
        inputs.set(
          instruction.target,
          instruction.operator === "typeof-external" ? host.getTypeof(value) : value,
        );
    }
  }
  const error = (name: Parameters<typeof createErrorValue>[0], message: string): StaticValue =>
    thrownValue(message, createErrorValue(name, [primitiveValue(message)], location), location);
  const clone = (state: ExecutionState): ExecutionState => ({
    values: new Map(state.values),
    uninitialized: new Set(state.uninitialized),
    visits: new Map(state.visits),
    exception: state.exception,
  });
  const getValue = (state: ExecutionState, value: number): StaticValue =>
    host.resolve(getRequired(state.values, value));
  const refineEquality = (state: ExecutionState, test: number, truthy: boolean): void => {
    let instruction = instructions.get(test);
    const visited = new Set<number>();
    while (
      instruction &&
      (instruction.kind === "copy" || instruction.kind === "read") &&
      !visited.has(instruction.target)
    ) {
      visited.add(instruction.target);
      instruction = instructions.get(instruction.operands[0]);
    }
    if (
      instruction?.kind !== "binary" ||
      (instruction.operator !== "===" && instruction.operator !== "!==")
    )
      return;
    if (truthy !== (instruction.operator === "===")) return;
    const [left, right] = instruction.operands.map((operand) => getValue(state, operand));
    const literal = left.kind === "primitive" ? left : right.kind === "primitive" ? right : null;
    const subject = literal === left ? right : left;
    if (!literal || literal.value === 0 || subject.kind !== "unknown-primitive") return;
    for (const [key, value] of state.values)
      if (host.resolve(value) === subject) state.values.set(key, literal);
  };
  const run = (entry: number, incoming: number | null, initial: ExecutionState): StaticValue => {
    let blockId = entry;
    let edgeId = incoming;
    const state = initial;
    for (;;) {
      const block = getRequired(graph.blocks, blockId);
      const isBackEdge =
        edgeId !== null &&
        getRequired(ranks, getRequired(graph.edges, edgeId).from) >= getRequired(ranks, blockId);
      const visits = isBackEdge ? (state.visits.get(blockId) ?? 0) + 1 : 0;
      if (visits >= MAX_UNROLLED_ITERATIONS)
        return unknownValue("SSA loop iteration limit exceeded", location);
      state.visits.set(blockId, visits);
      const phis = block.phis.map((phi) => {
        if (edgeId === null) throw new Error("SSA phi has no incoming edge");
        const operand = getRequired(phi.operands, edgeId);
        return {
          target: phi.target,
          value: getValue(state, operand),
          uninitialized: state.uninitialized.has(operand),
        };
      });
      for (const phi of phis) {
        state.values.set(phi.target, phi.value);
        if (phi.uninitialized) state.uninitialized.add(phi.target);
        else state.uninitialized.delete(phi.target);
      }
      for (const instruction of block.instructions) {
        if (!host.consumeStep()) return unknownValue("step budget exhausted", location);
        const fact = compiled.constants.values.get(instruction.target);
        if (fact?.kind === "constant") {
          state.values.set(instruction.target, primitiveValue(fact.value));
          state.uninitialized.delete(instruction.target);
          continue;
        }
        const operands = instruction.operands.map((operand) => getValue(state, operand));
        const nonScalar =
          instruction.kind === "unary" || instruction.kind === "binary"
            ? operands.find((operand) => !isScalar(operand))
            : undefined;
        if (nonScalar)
          throw new SsaDeoptimization({
            category: "deoptimization",
            reason: `${nonScalar.kind} operand`,
            node: instruction.node,
          });
        let value: StaticValue;
        state.uninitialized.delete(instruction.target);
        switch (instruction.kind) {
          case "constant":
            value = primitiveValue(instruction.constant);
            break;
          case "uninitialized":
            value = UNDEFINED_VALUE;
            state.uninitialized.add(instruction.target);
            break;
          case "input": {
            const variable = getRequired(graph.definitions, instruction.target).variable;
            value =
              inputs.get(instruction.target) ??
              (getRequired(graph.variables, variable).storage === "effect"
                ? UNDEFINED_VALUE
                : (state.exception ?? UNDEFINED_VALUE));
            break;
          }
          case "copy":
            value = operands[0];
            if (state.uninitialized.has(instruction.operands[0]))
              state.uninitialized.add(instruction.target);
            break;
          case "read":
            value = state.uninitialized.has(instruction.operands[0])
              ? error(
                  "ReferenceError",
                  `Cannot access '${graph.variables.get(getRequired(graph.definitions, instruction.operands[0]).variable)?.name ?? "binding"}' before initialization`,
                )
              : operands[0];
            break;
          case "effect":
            value = UNDEFINED_VALUE;
            break;
          case "opaque":
            if (instruction.operator === "load-reference") {
              const receiver = operands[1];
              const member = instruction.node;
              if (
                receiver.kind !== "object" ||
                !getErrorWitness(receiver) ||
                member?.type !== "MemberExpression" ||
                member.property.type !== "Identifier"
              )
                throw new SsaDeoptimization({
                  category: "deoptimization",
                  reason: `property read on ${receiver.kind}`,
                  node: instruction.node,
                });
              value = getObjectProperty(receiver, member.property.name);
            } else
              value =
                instruction.operator === "invalid-assignment"
                  ? error("TypeError", "Assignment to constant variable.")
                  : getRequired(inputs, instruction.target);
            break;
          case "binary":
            if (instruction.operator === "instanceof")
              value = error("TypeError", "Right-hand side of 'instanceof' is not an object");
            else if (
              EQUALITY_OPERATORS.has(instruction.operator ?? "") &&
              operands.some(isNaNValue)
            )
              value = primitiveValue(
                instruction.operator === "!==" || instruction.operator === "!=",
              );
            else value = applyBinaryOperator(instruction.operator ?? "", operands[0], operands[1]);
            break;
          case "unary": {
            const operand = operands[0];
            switch (instruction.operator) {
              case "typeof":
                value = host.getTypeof(operand);
                break;
              case "void":
                value = UNDEFINED_VALUE;
                break;
              case "!":
              case "+":
              case "-":
              case "~":
                value = applyUnaryOperator(instruction.operator, operand);
                break;
              case "to-numeric":
                value =
                  operand.kind === "primitive" && typeof operand.value === "bigint"
                    ? operand
                    : applyUnaryOperator("+", operand);
                break;
              case "increment":
              case "decrement":
                value =
                  operand.kind === "primitive" && typeof operand.value === "bigint"
                    ? primitiveValue(
                        instruction.operator === "increment"
                          ? operand.value + 1n
                          : operand.value - 1n,
                      )
                    : applyBinaryOperator(
                        instruction.operator === "increment" ? "+" : "-",
                        operand,
                        primitiveValue(1),
                      );
                break;
              default:
                throw new Error(`Unsupported SSA unary ${instruction.operator}`);
            }
            break;
          }
          default:
            throw new Error(`Unsupported SSA instruction ${instruction.kind}`);
        }
        state.values.set(instruction.target, value);
      }
      const terminal = block.terminal;
      const value = terminal.value === null ? UNDEFINED_VALUE : getValue(state, terminal.value);
      if (terminal.kind === "return") return value;
      if (terminal.kind === "throw") return thrownValue("SSA function threw", value, location);
      const follow = (edge: number, next: ExecutionState): StaticValue =>
        run(getRequired(graph.edges, edge).to, edge, next);
      if (terminal.kind === "branch") {
        const firstEdge = getRequired(graph.edges, terminal.edges[0]);
        const nullish = firstEdge.kind === "nullish";
        const certainty = nullish ? isNullish(value) : getTruthiness(value);
        if (certainty !== null) {
          if (!nullish && terminal.value !== null) refineEquality(state, terminal.value, certainty);
          edgeId = terminal.edges[certainty ? 0 : 1];
        } else {
          const paths = terminal.edges.map((edge, index) => () => {
            const next = clone(state);
            if (!nullish && terminal.value !== null)
              refineEquality(next, terminal.value, index === 0);
            return follow(edge, next);
          });
          return host.fork(
            nullish ? getPresencePredicate(value) : getTruthinessPredicate(value),
            nullish ? [paths[1], paths[0]] : paths,
          );
        }
      } else if (terminal.kind === "invoke") {
        const normal = terminal.edges.find(
          (edge) => getRequired(graph.edges, edge).kind === "normal",
        );
        const exceptional = terminal.edges.find(
          (edge) => getRequired(graph.edges, edge).kind === "throw",
        );
        if (normal === undefined || exceptional === undefined)
          throw new Error("Unsupported SSA suspension");
        const certainty = getThrowCertainty(value);
        if (certainty === "maybe" || (certainty === "always" && value.kind === "branch"))
          return host.distribute(value, (alternative) => {
            const next = clone(state);
            if (terminal.value !== null) next.values.set(terminal.value, alternative);
            if (alternative.kind === "unknown" && alternative.thrown) {
              next.exception = alternative.thrown;
              return follow(exceptional, next);
            }
            return follow(normal, next);
          });
        if (value.kind === "unknown" && value.thrown) {
          state.exception = value.thrown;
          edgeId = exceptional;
        } else edgeId = normal;
      } else if (terminal.kind === "jump") {
        edgeId = terminal.edges[0];
        if (getRequired(graph.edges, edgeId).kind === "throw" && terminal.value !== null)
          state.exception = value;
      } else throw new Error("Reached unreachable SSA block");
      blockId = getRequired(graph.edges, edgeId).to;
    }
  };
  const entryBudget = context.budget.remaining;
  try {
    return {
      value: run(graph.entry, null, {
        values: new Map(),
        uninitialized: new Set(),
        visits: new Map(),
        exception: null,
      }),
      blocker: null,
      compilation: sample,
    };
  } catch (error) {
    if (error instanceof SsaDeoptimization) {
      context.budget.remaining = entryBudget;
      return decline(error.blocker, sample);
    }
    throw error;
  }
};

export const executeSsa = (
  node: FunctionLikeNode,
  context: EvaluationContext,
  host: SsaExecutionHost,
  location: SourceLocation | null,
): StaticValue | null => {
  const profile = getSsaProfile();
  if (!profile) return attemptSsa(node, context, host, location, false).value;
  const startedAt = performance.now();
  const attempt = attemptSsa(node, context, host, location, true);
  const file = context.module.file;
  recordSsaAttempt(profile, node, file, {
    fallback: attempt.blocker && {
      category: attempt.blocker.category,
      reason: attempt.blocker.reason,
      location: attempt.blocker.node && getSourceLocation(file, attempt.blocker.node),
    },
    isUncertain:
      attempt.value?.kind === "unknown-primitive" ||
      (attempt.value?.kind === "unknown" && !attempt.value.thrown),
    milliseconds: performance.now() - startedAt,
    compilation: attempt.compilation,
  });
  return attempt.value;
};
