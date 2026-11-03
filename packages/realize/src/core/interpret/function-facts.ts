import { InstructionKind } from "../../react-compiler/HIR/HIR";
import type {
  BasicBlock,
  BlockId,
  HIRFunction,
  IdentifierId,
  Instruction,
  InstructionValue,
  Place,
  Terminal,
} from "../../react-compiler/HIR/HIR";
import {
  eachInstructionLValue,
  eachInstructionLValueWithKind,
  eachInstructionOperand,
  eachTerminalOperand,
  eachTerminalSuccessor,
} from "../../react-compiler/HIR/visitors";
import { getLoopHeaders } from "./control-flow";
import type { LoopTerminal } from "./control-flow";
import { getConditionallyMutatedPlace, getMutatedPlace } from "./get-mutated-place";
import { isFunctionCreation } from "./is-function-creation";

export type BranchOperator = "ternary" | "&&" | "||" | "??" | "optional" | "optional-chain-tail";

export interface EnvironmentFacts {
  propertyNames: string[];
  propertyObjects: Place[];
  branchOperators: BranchOperator[];
  itemSources: Place[];
  constantContextIds: boolean[];
}

export interface LoopFacts {
  isUnrollable: boolean;
  contextStores: Place[];
  outsideOperands: Place[];
}

export interface FunctionFacts {
  contextWrites: Place[];
  capturedContextStores: Place[];
  capturedContextWrites: Place[];
  reassignedIds: Set<IdentifierId>;
  storedLocals: Map<IdentifierId, Place>;
  closureMutatedLocals: Map<IdentifierId, Place>;
  hasLoop: boolean;
  branchContextStores: Place[][];
  loops: LoopFacts[];
}

const CONSTANT_DECLARATION_KINDS = new Set([
  InstructionKind.Const,
  InstructionKind.HoistedConst,
  InstructionKind.Function,
  InstructionKind.HoistedFunction,
]);

const LOOP_KINDS = new Set(["for", "for-of", "for-in", "while", "do-while"]);

const CONTEXT_WRITE_KINDS = new Set<InstructionValue["kind"]>([
  "StoreContext",
  "PrefixUpdateContext",
  "PostfixUpdateContext",
]);

const UNROLLABLE_INSTRUCTIONS = new Set<InstructionValue["kind"]>([
  "LoadLocal",
  "StoreLocal",
  "DeclareLocal",
  "Primitive",
  "BinaryExpression",
  "UnaryExpression",
  "PrefixUpdateLocal",
  "PostfixUpdateLocal",
  "TemplateLiteral",
  "PropertyLoad",
  "ComputedLoad",
]);

const UNROLLABLE_TERMINALS = new Set([
  "goto",
  "if",
  "branch",
  "ternary",
  "logical",
  "optional",
  "switch",
  "label",
  "sequence",
  "return",
]);

const isLoopTerminal = (terminal: BasicBlock["terminal"]): terminal is LoopTerminal =>
  LOOP_KINDS.has(terminal.kind);

const dedupeById = (places: Place[]): Place[] => [
  ...new Map(places.map((place) => [place.identifier.id, place])).values(),
];

const getContextWrites = (instruction: Instruction): Place[] =>
  CONTEXT_WRITE_KINDS.has(instruction.value.kind)
    ? [...eachInstructionLValueWithKind(instruction)].map(([place]) => place)
    : [];

const getInstructions = (hirFunction: HIRFunction): Instruction[] =>
  [...hirFunction.body.blocks.values()].flatMap((block) => block.instructions);

const getNestedInstructions = (hirFunction: HIRFunction): Instruction[] =>
  getInstructions(hirFunction).flatMap((instruction) =>
    isFunctionCreation(instruction.value)
      ? getNestedInstructions(instruction.value.loweredFunc.func)
      : [instruction],
  );

const getContextStoreKinds = (hirFunction: HIRFunction): Array<[Place, InstructionKind]> =>
  getNestedInstructions(hirFunction).flatMap((instruction) =>
    instruction.value.kind === "StoreContext"
      ? [...eachInstructionLValueWithKind(instruction)]
      : [],
  );

const getMutatedPlaces = (hirFunction: HIRFunction): Place[] =>
  (hirFunction.aliasingEffects ?? []).flatMap((effect) => {
    const mutatedPlace = getMutatedPlace(effect);
    return mutatedPlace ? [mutatedPlace] : [];
  });

const getStoredLocals = (hirFunction: HIRFunction): Map<IdentifierId, Place> =>
  new Map(
    getInstructions(hirFunction).flatMap((instruction): Array<[IdentifierId, Place]> =>
      instruction.value.kind === "StoreLocal"
        ? [[instruction.value.value.identifier.id, instruction.value.lvalue.place]]
        : [],
    ),
  );

const getClosureMutatedIds = (hirFunction: HIRFunction): IdentifierId[] =>
  getInstructions(hirFunction).flatMap((instruction) => {
    if (!isFunctionCreation(instruction.value)) return [];
    const nestedFunction = instruction.value.loweredFunc.func;
    const mutatedIds = [
      ...(instruction.effects ?? []),
      ...(nestedFunction.aliasingEffects ?? []),
    ].flatMap((effect) => {
      const mutatedPlace = getMutatedPlace(effect) ?? getConditionallyMutatedPlace(effect);
      return mutatedPlace ? [mutatedPlace.identifier.id] : [];
    });
    return [...mutatedIds, ...getClosureMutatedIds(nestedFunction)];
  });

const getNestedFunctions = (hirFunction: HIRFunction): HIRFunction[] => [
  hirFunction,
  ...getInstructions(hirFunction).flatMap((instruction) =>
    isFunctionCreation(instruction.value)
      ? getNestedFunctions(instruction.value.loweredFunc.func)
      : [],
  ),
];

type ValueBranchTerminal = Extract<Terminal, { kind: "ternary" | "logical" | "optional" }>;

const isValueBranch = (terminal: Terminal): terminal is ValueBranchTerminal =>
  terminal.kind === "ternary" || terminal.kind === "logical" || terminal.kind === "optional";

const getBranchOperator = (terminal: ValueBranchTerminal): BranchOperator => {
  if (terminal.kind === "logical") return terminal.operator;
  if (terminal.kind === "optional" && !terminal.optional) return "optional-chain-tail";
  return terminal.kind;
};

const addPropertyFacts = (facts: EnvironmentFacts, instruction: Instruction): void => {
  const value = instruction.value;
  if (value.kind === "PropertyLoad") {
    facts.propertyNames[instruction.lvalue.identifier.id] = String(value.property);
    facts.propertyObjects[instruction.lvalue.identifier.id] = value.object;
    return;
  }
  const [from, to] =
    value.kind === "StoreLocal"
      ? [value.value, value.lvalue.place]
      : value.kind === "LoadLocal"
        ? [value.place, instruction.lvalue]
        : [null, null];
  if (!from || !to) return;
  const name = facts.propertyNames[from.identifier.id];
  const object = facts.propertyObjects[from.identifier.id];
  if (name !== undefined) facts.propertyNames[to.identifier.id] = name;
  if (object) facts.propertyObjects[to.identifier.id] = object;
};

const addItemSource = (facts: EnvironmentFacts, instruction: Instruction): void => {
  const value = instruction.value;
  const [item] = value.kind === "ArrayExpression" ? value.elements : [];
  if (
    value.kind === "ArrayExpression" &&
    value.elements.length === 1 &&
    item?.kind === "Identifier"
  )
    facts.itemSources[instruction.lvalue.identifier.id] = item;
};

export const buildEnvironmentFacts = (rootFunction: HIRFunction): EnvironmentFacts => {
  const facts: EnvironmentFacts = {
    propertyNames: [],
    propertyObjects: [],
    branchOperators: [],
    itemSources: [],
    constantContextIds: [],
  };
  for (const hirFunction of getNestedFunctions(rootFunction))
    for (const block of hirFunction.body.blocks.values()) {
      for (const instruction of block.instructions) {
        addPropertyFacts(facts, instruction);
        addItemSource(facts, instruction);
        if (
          instruction.value.kind === "StoreContext" &&
          CONSTANT_DECLARATION_KINDS.has(instruction.value.lvalue.kind)
        )
          facts.constantContextIds[instruction.value.lvalue.place.identifier.id] = true;
      }
      if (isValueBranch(block.terminal))
        facts.branchOperators[block.terminal.fallthrough] = getBranchOperator(block.terminal);
    }
  return facts;
};

const getBlock = (hirFunction: HIRFunction, blockId: BlockId): BasicBlock => {
  const block = hirFunction.body.blocks.get(blockId);
  if (!block) throw new Error(`Block bb${blockId} is missing`);
  return block;
};

const getBlocksBetween = (
  hirFunction: HIRFunction,
  entry: BlockId,
  exit: BlockId,
): BasicBlock[] => {
  const visitedBlocks = new Set([entry, exit]);
  const blocks = [getBlock(hirFunction, entry)];
  for (const block of blocks)
    for (const successor of eachTerminalSuccessor(block.terminal)) {
      if (visitedBlocks.has(successor)) continue;
      visitedBlocks.add(successor);
      blocks.push(getBlock(hirFunction, successor));
    }
  return blocks;
};

const getRegionContextStores = (
  hirFunction: HIRFunction,
  entry: BlockId,
  exit: BlockId,
): Place[] =>
  entry === exit
    ? []
    : getBlocksBetween(hirFunction, entry, exit).flatMap((block) =>
        block.instructions.flatMap(getContextWrites),
      );

const isUnrollableBlock = (block: BasicBlock): boolean =>
  UNROLLABLE_TERMINALS.has(block.terminal.kind) &&
  block.instructions.every((instruction) => UNROLLABLE_INSTRUCTIONS.has(instruction.value.kind));

const getOutsideOperands = (blocks: BasicBlock[]): Place[] => {
  const definedIds = new Set(
    blocks.flatMap((block) => [
      ...[...block.phis].map((phi) => phi.place.identifier.id),
      ...block.instructions.flatMap((instruction) =>
        [...eachInstructionLValue(instruction)].map((lvalue) => lvalue.identifier.id),
      ),
    ]),
  );
  return blocks
    .flatMap((block) => [
      ...[...block.phis].flatMap((phi) => [...phi.operands.values()]),
      ...block.instructions.flatMap((instruction) => [...eachInstructionOperand(instruction)]),
      ...eachTerminalOperand(block.terminal),
    ])
    .filter((operand) => !definedIds.has(operand.identifier.id));
};

const getLoopFacts = (hirFunction: HIRFunction, terminal: LoopTerminal): LoopFacts => {
  const [loopEntry = terminal.fallthrough] = getLoopHeaders(terminal);
  const blocks = getBlocksBetween(hirFunction, loopEntry, terminal.fallthrough);
  return {
    isUnrollable: blocks.every(isUnrollableBlock),
    contextStores: getRegionContextStores(hirFunction, loopEntry, terminal.fallthrough),
    outsideOperands: getOutsideOperands(blocks),
  };
};

export const buildFunctionFacts = (hirFunction: HIRFunction): FunctionFacts => {
  const capturedIds = new Set(hirFunction.context.map((place) => place.identifier.id));
  const contextStores = getContextStoreKinds(hirFunction);
  const storedPlaces = contextStores.map(([place]) => place);
  const isCaptured = (place: Place): boolean => capturedIds.has(place.identifier.id);
  const storedLocals = getStoredLocals(hirFunction);
  const closureMutatedIds = new Set(getClosureMutatedIds(hirFunction));
  const blocks = [...hirFunction.body.blocks.values()];
  const branchContextStores: Place[][] = [];
  const loops: LoopFacts[] = [];
  for (const block of blocks) {
    const terminal = block.terminal;
    if (terminal.kind === "if" || terminal.kind === "branch")
      branchContextStores[block.id] = dedupeById([
        ...getRegionContextStores(hirFunction, terminal.consequent, terminal.fallthrough),
        ...getRegionContextStores(hirFunction, terminal.alternate, terminal.fallthrough),
      ]);
    if (isLoopTerminal(terminal)) loops[block.id] = getLoopFacts(hirFunction, terminal);
  }
  return {
    contextWrites: dedupeById(getInstructions(hirFunction).flatMap(getContextWrites)),
    capturedContextStores: storedPlaces.filter(isCaptured),
    capturedContextWrites: [...storedPlaces, ...getMutatedPlaces(hirFunction)].filter(isCaptured),
    reassignedIds: new Set(
      contextStores.flatMap(([place, kind]) =>
        kind === InstructionKind.Reassign ? [place.identifier.id] : [],
      ),
    ),
    storedLocals,
    closureMutatedLocals: new Map(
      [...storedLocals].filter(([, local]) => closureMutatedIds.has(local.identifier.id)),
    ),
    hasLoop: blocks.some((block) => isLoopTerminal(block.terminal)),
    branchContextStores,
    loops,
  };
};
