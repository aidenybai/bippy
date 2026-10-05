import type { StaticPrimitive } from "../types.js";
import {
  getRequired,
  type ConstantAnalysis,
  type ConstantFact,
  type FlowInstruction,
  type SsaGraph,
} from "./ir.js";

const UNREACHED: ConstantFact = { kind: "unreached" };
const OVERDEFINED: ConstantFact = { kind: "overdefined" };
const constant = (value: StaticPrimitive): ConstantFact => ({ kind: "constant", value });

const merge = (left: ConstantFact, right: ConstantFact): ConstantFact => {
  if (left.kind === "unreached") return right;
  if (right.kind === "unreached") return left;
  if (left.kind === "constant" && right.kind === "constant" && Object.is(left.value, right.value))
    return left;
  return OVERDEFINED;
};

const fold = (instruction: FlowInstruction, operands: ConstantFact[]): ConstantFact => {
  if (instruction.kind === "constant") return constant(instruction.constant);
  if (instruction.kind === "copy" || instruction.kind === "read") return operands[0];
  if (instruction.kind !== "unary" && instruction.kind !== "binary") return OVERDEFINED;
  const scalarOperands = operands.slice(0, instruction.kind === "unary" ? 1 : 2);
  if (scalarOperands.some((operand) => operand.kind === "overdefined")) return OVERDEFINED;
  if (scalarOperands.some((operand) => operand.kind === "unreached")) return UNREACHED;
  const [left, right] = scalarOperands.map((operand) => operand.value);
  const operator = instruction.operator;
  if (instruction.kind === "unary") {
    if (operator === "typeof") return constant(typeof left);
    if (operator === "void") return constant(undefined);
    if (operator === "!") return constant(!left);
    if (operator === "to-numeric") return constant(typeof left === "bigint" ? left : Number(left));
    if (operator === "increment")
      return constant(typeof left === "bigint" ? left + 1n : Number(left) + 1);
    if (operator === "decrement")
      return constant(typeof left === "bigint" ? left - 1n : Number(left) - 1);
    if (typeof left === "number") {
      if (operator === "+") return constant(+left);
      if (operator === "-") return constant(-left);
      if (operator === "~") return constant(~left);
    }
    return OVERDEFINED;
  }
  if (operator === "===") return constant(left === right);
  if (operator === "!==") return constant(left !== right);
  if (typeof left === "string" && typeof right === "string") {
    switch (operator) {
      case "+":
        return constant(left + right);
      case "<":
        return constant(left < right);
      case "<=":
        return constant(left <= right);
      case ">":
        return constant(left > right);
      case ">=":
        return constant(left >= right);
    }
  }
  if (typeof left !== "number" || typeof right !== "number") return OVERDEFINED;
  switch (operator) {
    case "+":
      return constant(left + right);
    case "-":
      return constant(left - right);
    case "*":
      return constant(left * right);
    case "/":
      return constant(left / right);
    case "%":
      return constant(left % right);
    case "**":
      return constant(left ** right);
    case "<":
      return constant(left < right);
    case "<=":
      return constant(left <= right);
    case ">":
      return constant(left > right);
    case ">=":
      return constant(left >= right);
    case "&":
      return constant(left & right);
    case "|":
      return constant(left | right);
    case "^":
      return constant(left ^ right);
    case "<<":
      return constant(left << right);
    case ">>":
      return constant(left >> right);
    case ">>>":
      return constant(left >>> right);
    default:
      return OVERDEFINED;
  }
};

export const propagateConstants = (graph: SsaGraph): ConstantAnalysis => {
  const result: ConstantAnalysis = {
    values: new Map(),
    executableEdges: new Set(),
    executableBlocks: new Set([graph.entry]),
  };
  const users = new Map<number, Set<number>>();
  const pending = new Set<number>([graph.entry]);
  const getFact = (value: number): ConstantFact => result.values.get(value) ?? UNREACHED;
  const addUse = (value: number, block: number): void => {
    const blocks = users.get(value) ?? new Set<number>();
    blocks.add(block);
    users.set(value, blocks);
  };
  for (const block of graph.blocks.values()) {
    for (const phi of block.phis)
      for (const operand of phi.operands.values()) addUse(operand, block.id);
    for (const instruction of block.instructions)
      for (const operand of instruction.operands) addUse(operand, block.id);
    if (block.terminal.value !== null) addUse(block.terminal.value, block.id);
  }
  const update = (target: number, incoming: ConstantFact): void => {
    const previous = getFact(target);
    const next = merge(previous, incoming);
    if (
      previous.kind === next.kind &&
      (next.kind !== "constant" || Object.is(previous.value, next.value))
    )
      return;
    result.values.set(target, next);
    for (const user of users.get(target) ?? [])
      if (result.executableBlocks.has(user)) pending.add(user);
  };
  while (pending.size) {
    const blockId = pending.values().next().value!;
    pending.delete(blockId);
    const block = getRequired(graph.blocks, blockId);
    for (const phi of block.phis) {
      let fact = UNREACHED;
      for (const [edge, operand] of phi.operands)
        if (result.executableEdges.has(edge)) fact = merge(fact, getFact(operand));
      update(phi.target, fact);
    }
    for (const instruction of block.instructions)
      update(instruction.target, fold(instruction, instruction.operands.map(getFact)));
    const terminal = block.terminal;
    const test = terminal.value === null ? OVERDEFINED : getFact(terminal.value);
    for (const edgeId of terminal.edges) {
      const edge = getRequired(graph.edges, edgeId);
      if (terminal.kind === "invoke" && edge.kind === "throw" && test.kind === "constant") continue;
      if (terminal.kind === "branch") {
        if (test.kind === "unreached") continue;
        if (test.kind === "constant") {
          const isNullish = test.value === null || test.value === undefined;
          if (
            (edge.kind === "truthy" && !test.value) ||
            (edge.kind === "falsy" && !!test.value) ||
            (edge.kind === "nullish" && !isNullish) ||
            (edge.kind === "defined" && isNullish)
          )
            continue;
        }
      }
      if (!result.executableEdges.has(edgeId)) {
        result.executableEdges.add(edgeId);
        result.executableBlocks.add(edge.to);
        pending.add(edge.to);
      }
    }
  }
  return result;
};
