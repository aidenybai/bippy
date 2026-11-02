import type {
  BasicBlock,
  BlockId,
  HIRFunction,
  IdentifierId,
  InstructionValue,
  Phi,
  Place,
  SourceLocation,
  Terminal,
} from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import {
  eachInstructionLValue,
  eachInstructionOperand,
  eachTerminalOperand,
  eachTerminalSuccessor,
} from "../../react-compiler/HIR/visitors";
import { assertExhaustive } from "../../react-compiler/Utils/utils";
import type { Binding, SymbolicValue, TestKind } from "../types";
import {
  createConditional,
  getGuard,
  getLoopExit,
  getLoopHeaders,
  hasFallthrough,
  isFallthroughOnly,
  collapseLoopSplits,
  mapFallthroughs,
} from "./control-flow";
import type {
  BranchTerminal,
  ContextValue,
  FallthroughCompletion,
  LoopTerminal,
  Completion,
  SplitCompletion,
  SwitchTerminal,
} from "./control-flow";
import {
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  foldBinary,
  getKnownOutcome,
  getShortCircuit,
} from "../values/symbolic-values";
import { PlaceMap } from "../values/place-map";
import { getDeclarationLocation } from "./get-declaration-location";
import { getIdentifierName } from "./get-identifier-name";
import { getTestExpression } from "../values/get-test-expression";
import { negate } from "../values/negate";
import type { Interpreter } from "./interpret";
import { getAsyncPathState } from "./path-state";
import type { PathState } from "./path-state";

export type BranchOperator = "ternary" | "&&" | "||" | "??" | "optional" | "optional-chain-tail";

type ValueBranchTerminal = Extract<Terminal, { kind: "ternary" | "logical" | "optional" }>;

type MaybeThrowTerminal = Extract<Terminal, { kind: "maybe-throw" }>;

type TryTerminal = Extract<Terminal, { kind: "try" }>;

type PhiState = "resolved" | "unresolved";

interface NextStep {
  kind: "Next";
  block: BlockId;
}

type TerminalStep = Completion | NextStep;

interface BranchTest {
  test: SymbolicValue;
  testKind: TestKind;
  knownOutcome: boolean | null;
}

interface SwitchWalk {
  terminal: SwitchTerminal;
  from: BlockId;
  discriminant: SymbolicValue;
}

const MAX_BLOCK_VISITS = 20_000;
const MAX_UNROLLED_ITERATIONS = 32;
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
const UNROLLABLE_TERMINALS = new Set<Terminal["kind"]>([
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
const MAX_WALK_DEPTH = 256;
const NULLISH_BRANCH_OPERATORS = new Set<BranchOperator>(["??", "optional", "optional-chain-tail"]);

const getBranchTest = (operator: BranchOperator, testedValue: SymbolicValue): BranchTest => {
  const shortCircuit = operator === "optional-chain-tail" ? getShortCircuit(testedValue) : null;
  const test = shortCircuit?.test ?? testedValue;
  const testKind: TestKind =
    shortCircuit?.testKind ?? (NULLISH_BRANCH_OPERATORS.has(operator) ? "nullish" : "truthy");
  const knownOutcome =
    operator === "optional-chain-tail" && !shortCircuit ? true : getKnownOutcome(test, testKind);
  return { test, testKind, knownOutcome };
};

const getReachTest = (
  completion: Completion,
  block: BlockId,
  guards: SymbolicValue[] = [],
): SymbolicValue => {
  if (completion.kind !== "Split")
    return {
      kind: "Primitive",
      value: completion.kind === "Fallthrough" && completion.to === block,
    };
  const conditional = createConditional(completion, guards, (edge, edgeGuards) =>
    getReachTest(edge, block, edgeGuards),
  );
  const isUndecided =
    conditional.consequent.kind !== "Primitive" ||
    conditional.alternate.kind !== "Primitive" ||
    conditional.consequent.value !== conditional.alternate.value;
  return isUndecided ? conditional : conditional.consequent;
};

const getBranchOperator = (terminal: ValueBranchTerminal): BranchOperator => {
  if (terminal.kind === "logical") return terminal.operator;
  if (terminal.kind === "optional" && !terminal.optional) return "optional-chain-tail";
  return terminal.kind;
};

interface ThrowPoint {
  pathState: PathState;
  test: SymbolicValue;
}

interface FunctionScope {
  walkedCatches: Set<BlockId>;
  throwPointsByTry: ThrowPoint[][];
  catchBindings: Map<BlockId, Place | null>;
}

export const createFunctionScope = (): FunctionScope => ({
  walkedCatches: new Set(),
  throwPointsByTry: [],
  catchBindings: new Map(),
});

export class ControlFlowWalker {
  readonly #interpreter: Interpreter;
  blockVisits = 0;
  #walkDepth = 0;
  #loopDepth = 0;
  readonly #enteredLoopHeaders = new Map<BlockId, boolean>();
  readonly #loopContextPlaces = new Map<BlockId, Place[]>();
  readonly #unrolledLoopHeaders = new Set<BlockId>();
  readonly #trackedContextPlaces = new WeakMap<HIRFunction, Place[]>();
  functionScope = createFunctionScope();
  readonly #throwingCatches = new Set<BlockId>();
  #awaitCount = 0;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  get loopDepth(): number {
    return this.#loopDepth;
  }

  runRepeated<Result>(run: () => Result): Result {
    this.#loopDepth++;
    try {
      return run();
    } finally {
      this.#loopDepth--;
    }
  }

  #resolvePhi(phi: Phi, completion: Completion, guards: SymbolicValue[]): SymbolicValue {
    switch (completion.kind) {
      case "Fallthrough": {
        const operand = completion.from === null ? undefined : phi.operands.get(completion.from);
        return operand ? this.#interpreter.read(operand) : createUnknown("loop", phi.place.loc);
      }
      case "Split":
        return createConditional(completion, guards, (edge, edgeGuards) =>
          this.#resolvePhi(phi, edge, edgeGuards),
        );
      case "Return":
        return createUnknown("unreachable", phi.place.loc);
      default:
        return assertExhaustive(completion, "Unhandled completion");
    }
  }

  #continueAfter(
    completion: Completion,
    join: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
    joinPhiState: PhiState = "unresolved",
  ): Completion {
    if (stops.has(join)) return completion;
    const block = this.#getBlock(join);
    if (isFallthroughOnly(completion, join)) {
      if (joinPhiState === "unresolved")
        for (const phi of block.phis)
          this.#interpreter.write(phi.place, this.#resolvePhi(phi, completion, pathState.guards));
      this.#mergeContextValues(completion, join, pathState.guards);
      return this.walk(join, stops, null, pathState, "resolved");
    }
    const resumeAtJoin = (edge: Completion, guards: SymbolicValue[]): Completion => {
      switch (edge.kind) {
        case "Return":
          return edge;
        case "Fallthrough":
          if (edge.to !== join) return edge;
          this.#restoreContextValues(edge);
          return this.walk(join, stops, edge.from, { ...pathState, guards }, joinPhiState);
        case "Split":
          return this.#nestWalk(() => ({
            ...edge,
            consequent: resumeAtJoin(edge.consequent, [...guards, getGuard(edge, true)]),
            alternate: resumeAtJoin(edge.alternate, [...guards, getGuard(edge, false)]),
          }));
        default:
          return assertExhaustive(edge, "Unhandled completion");
      }
    };
    return hasFallthrough(completion, join)
      ? resumeAtJoin(completion, pathState.guards)
      : completion;
  }

  #getBlock(blockId: BlockId): BasicBlock {
    const block = this.#interpreter.getCurrentFunction().body.blocks.get(blockId);
    if (!block) throw new Error(`Block bb${blockId} is missing`);
    return block;
  }

  #walkBranch(
    terminal: BranchTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): Completion {
    const operator =
      this.#interpreter.getCompilationTables().branchOperators.get(terminal.fallthrough) ??
      "ternary";
    const branchTest = getBranchTest(operator, this.#interpreter.read(terminal.test));
    const testGuard = getTestExpression(branchTest);
    const successorStops = new Set([...stops, terminal.fallthrough]);
    const isSwapped = operator === "&&";
    const consequentGuard = isSwapped ? negate(testGuard) : testGuard;
    const branch = this.#interpreter.createBranchSite(
      terminal.test.loc,
      this.#interpreter.resolver.isExpression(terminal.test.loc) ? branchTest.testKind : null,
    );
    const walkConsequent = () =>
      this.#walkSuccessor(terminal.consequent, from, successorStops, pathState, consequentGuard);
    const walkAlternate = () =>
      this.#walkSuccessor(
        terminal.alternate,
        from,
        successorStops,
        pathState,
        negate(consequentGuard),
      );
    if (this.#interpreter.handlerEffects === null)
      this.#interpreter.branchEvaluations.push({
        branch,
        test: testGuard,
        outcome: branchTest.knownOutcome,
        guards: pathState.guards,
      });
    if (branchTest.knownOutcome !== null) {
      const takenSuccessor =
        branchTest.knownOutcome !== isSwapped ? terminal.consequent : terminal.alternate;
      return this.#continueAfter(
        this.#walkSuccessor(takenSuccessor, from, successorStops, pathState, null),
        terminal.fallthrough,
        stops,
        pathState,
      );
    }
    const storedPlaces = this.#getSuccessorStoredContextPlaces(
      [terminal.consequent, terminal.alternate],
      terminal.fallthrough,
    );
    const valuesBefore = storedPlaces.map((place) => this.#interpreter.read(place));
    const consequentCompletion = walkConsequent();
    const consequentValues = storedPlaces.map((place) => this.#interpreter.read(place));
    storedPlaces.forEach((place, index) => this.#interpreter.write(place, valuesBefore[index]));
    const alternateCompletion = walkAlternate();
    const splitCompletion: SplitCompletion = {
      kind: "Split",
      test: branchTest.test,
      testKind: branchTest.testKind,
      branch,
      consequent: isSwapped ? alternateCompletion : consequentCompletion,
      alternate: isSwapped ? consequentCompletion : alternateCompletion,
    };
    storedPlaces.forEach((place, index) => {
      const consequentValue = consequentValues[index] ?? UNDEFINED_VALUE;
      const alternateValue = this.#interpreter.read(place);
      if (consequentValue === alternateValue) return;
      const valuesByEdge = new Map<Completion, SymbolicValue>([
        [consequentCompletion, consequentValue],
        [alternateCompletion, alternateValue],
      ]);
      this.#interpreter.write(
        place,
        createConditional(
          splitCompletion,
          pathState.guards,
          (edge) => valuesByEdge.get(edge) ?? alternateValue,
        ),
      );
    });
    return this.#continueAfter(splitCompletion, terminal.fallthrough, stops, pathState);
  }

  #walkSuccessor(
    successorBlock: BlockId,
    from: BlockId,
    successorStops: ReadonlySet<BlockId>,
    pathState: PathState,
    guard: SymbolicValue | null,
  ): Completion {
    if (successorStops.has(successorBlock)) return this.#fallthrough(from, successorBlock);
    const guards = guard ? [...pathState.guards, guard] : pathState.guards;
    return this.walk(successorBlock, successorStops, from, { ...pathState, guards }, "unresolved");
  }

  #walkSwitch(
    terminal: SwitchTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): Completion {
    const switchWalk: SwitchWalk = {
      terminal,
      from,
      discriminant: this.#interpreter.read(terminal.test),
    };
    const caseBlocks = [...new Set(terminal.cases.map((switchCase) => switchCase.block))].filter(
      (block) => block !== terminal.fallthrough,
    );
    const casesCompletion = caseBlocks.reduce(
      (completion, block) =>
        this.#continueAtCase(
          completion,
          block,
          new Set([
            ...stops,
            terminal.fallthrough,
            ...caseBlocks.filter((caseBlock) => caseBlock !== block),
          ]),
          pathState,
        ),
      this.#dispatchSwitchCase(switchWalk, 0),
    );
    return this.#continueAfter(casesCompletion, terminal.fallthrough, stops, pathState);
  }

  #dispatchSwitchCase(switchWalk: SwitchWalk, caseIndex: number): Completion {
    const switchCase = switchWalk.terminal.cases[caseIndex];
    if (!switchCase) {
      const defaultCase = switchWalk.terminal.cases.find((candidate) => candidate.test === null);
      return this.#fallthrough(
        switchWalk.from,
        defaultCase?.block ?? switchWalk.terminal.fallthrough,
      );
    }
    if (switchCase.test === null) return this.#dispatchSwitchCase(switchWalk, caseIndex + 1);
    const caseTest = foldBinary(
      "===",
      switchWalk.discriminant,
      this.#interpreter.read(switchCase.test),
    );
    const matched: Completion = this.#fallthrough(switchWalk.from, switchCase.block);
    if (caseTest.kind === "Primitive")
      return caseTest.value ? matched : this.#dispatchSwitchCase(switchWalk, caseIndex + 1);
    return {
      kind: "Split",
      test: caseTest,
      testKind: "truthy",
      branch: this.#interpreter.createBranchSite(switchCase.test.loc),
      consequent: matched,
      alternate: this.#dispatchSwitchCase(switchWalk, caseIndex + 1),
    };
  }

  #continueAtCase(
    completion: Completion,
    block: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): Completion {
    const predecessors = new Set<BlockId | null>();
    mapFallthroughs(completion, (fallthrough) => {
      if (fallthrough.to === block) predecessors.add(fallthrough.from);
      return fallthrough;
    });
    if (predecessors.size < 2) return this.#continueAfter(completion, block, stops, pathState);
    for (const phi of this.#getBlock(block).phis)
      this.#interpreter.write(phi.place, this.#resolvePhi(phi, completion, pathState.guards));
    this.#mergeContextValues(completion, block, pathState.guards);
    const reachTest = getReachTest(completion, block);
    const casePathState =
      reachTest.kind === "Primitive"
        ? pathState
        : { ...pathState, guards: [...pathState.guards, reachTest] };
    const blockCompletion = this.walk(block, stops, null, casePathState, "resolved");
    return mapFallthroughs(completion, (fallthrough) =>
      fallthrough.to === block ? blockCompletion : fallthrough,
    );
  }

  #walkLoop(
    terminal: LoopTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): Completion {
    const unrolledCompletion = this.#unrollLoop(terminal, from, stops, pathState);
    if (unrolledCompletion) return unrolledCompletion;
    const loopHeaders = getLoopHeaders(terminal);
    const loopBindings: Binding[] = [];
    for (const loopHeader of loopHeaders) {
      this.#enteredLoopHeaders.set(loopHeader, false);
      for (const phi of this.#getBlock(loopHeader).phis)
        this.#interpreter.write(phi.place, this.#createLoopValue(phi, loopBindings));
    }
    const [loopEntry = terminal.fallthrough] = loopHeaders;
    const storedContextPlaces = this.#getStoredContextPlaces(loopEntry, terminal.fallthrough);
    for (const loopHeader of loopHeaders)
      if (!("init" in terminal) || loopHeader !== terminal.init)
        this.#loopContextPlaces.set(loopHeader, storedContextPlaces);
    this.#addLoopInputPlaces(loopBindings, loopEntry, terminal.fallthrough);
    const headerBindingCount = loopBindings.length;
    const awaitCountBefore = this.#awaitCount;
    this.#loopDepth++;
    let bodyCompletion: Completion;
    try {
      bodyCompletion = this.walk(
        loopEntry,
        new Set([...stops, terminal.fallthrough]),
        null,
        pathState,
        "resolved",
      );
    } finally {
      this.#loopDepth--;
      for (const loopHeader of loopHeaders) {
        this.#enteredLoopHeaders.delete(loopHeader);
        this.#loopContextPlaces.delete(loopHeader);
      }
    }
    const loopExit: Completion = {
      kind: "Fallthrough",
      from: getLoopExit(terminal),
      to: terminal.fallthrough,
    };
    const exitCompletion = collapseLoopSplits(
      mapFallthroughs(bodyCompletion, (fallthrough) =>
        fallthrough.to === terminal.fallthrough || loopHeaders.includes(fallthrough.to)
          ? loopExit
          : fallthrough,
      ),
      loopBindings,
      terminal.loc,
    );
    for (const phi of this.#getBlock(terminal.fallthrough).phis)
      this.#interpreter.write(phi.place, this.#createLoopValue(phi, loopBindings));
    this.#addLoopInputPlaces(
      loopBindings.slice(headerBindingCount),
      loopEntry,
      terminal.fallthrough,
    );
    for (const place of storedContextPlaces)
      this.#interpreter.write(place, createUnknown("loop", place.loc));
    const afterPathState =
      this.#awaitCount > awaitCountBefore ? getAsyncPathState(pathState) : pathState;
    return this.#continueAfter(
      exitCompletion,
      terminal.fallthrough,
      stops,
      afterPathState,
      "resolved",
    );
  }

  #unrollLoop(
    terminal: LoopTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): Completion | null {
    const loopHeaders = getLoopHeaders(terminal);
    const [loopEntry = terminal.fallthrough] = loopHeaders;
    const isUnrollable = this.#getBlocksBetween(loopEntry, terminal.fallthrough).every(
      (block) =>
        UNROLLABLE_TERMINALS.has(block.terminal.kind) &&
        block.instructions.every((instruction) =>
          UNROLLABLE_INSTRUCTIONS.has(instruction.value.kind),
        ),
    );
    if (!isUnrollable) return null;
    const loopStops = new Set([...stops, terminal.fallthrough]);
    for (const loopHeader of loopHeaders) this.#unrolledLoopHeaders.add(loopHeader);
    let completion: Completion = { kind: "Fallthrough", from, to: loopEntry };
    try {
      for (let iteration = 0; completion.kind === "Fallthrough"; iteration++) {
        const header = completion.to;
        if (!loopHeaders.includes(header)) break;
        if (iteration > MAX_UNROLLED_ITERATIONS) return null;
        const headerBlock = this.#getBlock(header);
        if (completion.from !== null)
          this.#resolveBlockPhis(headerBlock, completion.from, pathState.guards);
        for (const phi of headerBlock.phis)
          if (this.#interpreter.read(phi.place).kind !== "Primitive") return null;
        for (const loopHeader of loopHeaders) this.#enteredLoopHeaders.set(loopHeader, false);
        completion = this.walk(header, loopStops, completion.from, pathState, "resolved");
      }
    } finally {
      for (const loopHeader of loopHeaders) {
        this.#unrolledLoopHeaders.delete(loopHeader);
        this.#enteredLoopHeaders.delete(loopHeader);
      }
    }
    if (completion.kind === "Split") return null;
    return this.#continueAfter(completion, terminal.fallthrough, stops, pathState);
  }

  #getBlocksBetween(entry: BlockId, exit: BlockId): BasicBlock[] {
    const visitedBlocks = new Set([entry, exit]);
    const blocks = [this.#getBlock(entry)];
    for (const block of blocks)
      for (const successor of eachTerminalSuccessor(block.terminal)) {
        if (visitedBlocks.has(successor)) continue;
        visitedBlocks.add(successor);
        blocks.push(this.#getBlock(successor));
      }
    return blocks;
  }

  #getTrackedContextPlaces(): Place[] {
    const hirFunction = this.#interpreter.getCurrentFunction();
    const cached = this.#trackedContextPlaces.get(hirFunction);
    if (cached) return cached;
    const placesById = new Map<IdentifierId, Place>();
    for (const block of hirFunction.body.blocks.values())
      for (const instruction of block.instructions) {
        if (instruction.value.kind === "StoreContext")
          placesById.set(
            instruction.value.lvalue.place.identifier.id,
            instruction.value.lvalue.place,
          );
        if (
          instruction.value.kind === "PostfixUpdateContext" ||
          instruction.value.kind === "PrefixUpdateContext"
        )
          placesById.set(instruction.value.lvalue.identifier.id, instruction.value.lvalue);
      }
    const places = [...placesById.values()];
    this.#trackedContextPlaces.set(hirFunction, places);
    return places;
  }

  #getContextValues(): ReadonlyMap<IdentifierId, ContextValue> | null {
    const places = this.#getTrackedContextPlaces();
    if (places.length === 0) return null;
    return new Map(
      places.map((place): [IdentifierId, ContextValue] => [
        place.identifier.id,
        { place, value: this.#interpreter.read(place) },
      ]),
    );
  }

  #fallthrough(from: BlockId | null, to: BlockId): FallthroughCompletion {
    const contextValues = this.#getContextValues();
    return contextValues
      ? { kind: "Fallthrough", from, to, contextValues }
      : { kind: "Fallthrough", from, to };
  }

  #return(value: SymbolicValue): Completion {
    const contextValues = this.#getContextValues();
    return contextValues ? { kind: "Return", value, contextValues } : { kind: "Return", value };
  }

  mergeReturnedContextValues(completion: Completion, guards: SymbolicValue[]): void {
    this.#mergeContextValues(completion, null, guards);
  }

  #restoreContextValues(fallthrough: FallthroughCompletion): void {
    for (const contextValue of fallthrough.contextValues?.values() ?? [])
      this.#interpreter.write(contextValue.place, contextValue.value);
  }

  #mergeContextValues(completion: Completion, join: BlockId | null, guards: SymbolicValue[]): void {
    for (const place of this.#getTrackedContextPlaces()) {
      const merged = this.#getJoinedContextValue(completion, join, place.identifier.id, guards);
      if (merged) this.#interpreter.write(place, merged);
    }
  }

  #getJoinedContextValue(
    completion: Completion,
    join: BlockId | null,
    id: IdentifierId,
    guards: SymbolicValue[],
  ): SymbolicValue | null {
    if (completion.kind !== "Split") {
      const isJoined =
        join === null || (completion.kind === "Fallthrough" && completion.to === join);
      return isJoined ? (completion.contextValues?.get(id)?.value ?? null) : null;
    }
    const consequent = this.#getJoinedContextValue(completion.consequent, join, id, guards);
    const alternate = this.#getJoinedContextValue(completion.alternate, join, id, guards);
    if (!consequent || !alternate || consequent === alternate) return consequent ?? alternate;
    return createConditional(completion, guards, (edge) =>
      edge === completion.consequent ? consequent : alternate,
    );
  }

  #getSuccessorStoredContextPlaces(entries: BlockId[], exit: BlockId): Place[] {
    const placesById = new Map<IdentifierId, Place>();
    for (const entry of entries)
      for (const place of this.#getStoredContextPlaces(entry, exit))
        placesById.set(place.identifier.id, place);
    return [...placesById.values()];
  }

  #getStoredContextPlaces(entry: BlockId, exit: BlockId): Place[] {
    if (entry === exit) return [];
    return this.#getBlocksBetween(entry, exit).flatMap((block) =>
      block.instructions.flatMap((instruction) => {
        if (instruction.value.kind === "StoreContext") return [instruction.value.lvalue.place];
        return instruction.value.kind === "PostfixUpdateContext" ||
          instruction.value.kind === "PrefixUpdateContext"
          ? [instruction.value.lvalue]
          : [];
      }),
    );
  }

  #createLoopValue(phi: Phi, loopBindings: Binding[]): SymbolicValue {
    const variableName = getIdentifierName(phi.place);
    const declarationLoc = [phi.place, ...phi.operands.values()]
      .map(getDeclarationLocation)
      .find((candidate) => this.#interpreter.resolver.getDeclaredDomain(candidate) !== null);
    const declaredDomain =
      declarationLoc && this.#interpreter.resolver.getDeclaredDomain(declarationLoc);
    if (variableName === null || !declarationLoc || !declaredDomain)
      return createUnknown("loop", phi.place.loc);
    const binding = this.#interpreter.createBinding(variableName, "loop", declarationLoc, {
      domain: declaredDomain,
    });
    if (!loopBindings.includes(binding)) loopBindings.push(binding);
    return createBindingValue(binding);
  }

  #addLoopInputPlaces(loopBindings: Binding[], loopEntry: BlockId, loopFallthrough: BlockId): void {
    if (loopBindings.length === 0) return;
    const loopBlocks = this.#getBlocksBetween(loopEntry, loopFallthrough);
    const loopDefinedIds = new Set(
      loopBlocks.flatMap((block) => [
        ...[...block.phis].map((phi) => phi.place.identifier.id),
        ...block.instructions.flatMap((instruction) =>
          [...eachInstructionLValue(instruction)].map((lvalue) => lvalue.identifier.id),
        ),
      ]),
    );
    const inputPlaces = new PlaceMap<true>();
    for (const block of loopBlocks)
      for (const operand of [
        ...[...block.phis].flatMap((phi) => [...phi.operands.values()]),
        ...block.instructions.flatMap((instruction) => [...eachInstructionOperand(instruction)]),
        ...eachTerminalOperand(block.terminal),
      ])
        if (!loopDefinedIds.has(operand.identifier.id))
          this.#interpreter.collectInputPlaces(this.#interpreter.read(operand), inputPlaces);
    const loopBindingIds = new Set(loopBindings.map((binding) => binding.id));
    const outsidePlaces = inputPlaces
      .places()
      .filter((place) => !loopBindingIds.has(place.bindingId));
    for (const binding of loopBindings)
      binding.inputPlaces = [...binding.inputPlaces, ...outsidePlaces];
  }

  walk(
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    from: BlockId | null,
    pathState: PathState,
    entryPhiState: PhiState,
  ): Completion {
    return this.#nestWalk(() => this.#walkBlocks(blockId, stops, from, pathState, entryPhiState));
  }

  #nestWalk(walkNested: () => Completion): Completion {
    if (this.#walkDepth >= MAX_WALK_DEPTH) return this.#bailOutTooComplex("nests too many blocks");
    this.#walkDepth++;
    try {
      return walkNested();
    } finally {
      this.#walkDepth--;
    }
  }

  #bailOutTooComplex(message: string): Completion {
    this.#interpreter.diagnostics.bailOut("too-complex", message, GeneratedSource);
    return { kind: "Return", value: createUnknown("too-complex", GeneratedSource) };
  }

  #walkBlocks(
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    from: BlockId | null,
    pathState: PathState,
    entryPhiState: PhiState,
  ): Completion {
    let currentId = blockId;
    let previousId = from;
    let isPhiResolved = entryPhiState === "resolved";
    let currentPathState = pathState;
    while (true) {
      if (++this.blockVisits > MAX_BLOCK_VISITS)
        return this.#bailOutTooComplex("visits too many blocks");
      const isLoopHeader = this.#enteredLoopHeaders.has(currentId);
      if (isLoopHeader) {
        if (this.#enteredLoopHeaders.get(currentId))
          return { kind: "Fallthrough", from: previousId, to: currentId };
        this.#enteredLoopHeaders.set(currentId, true);
        for (const place of this.#loopContextPlaces.get(currentId) ?? [])
          this.#interpreter.write(place, createUnknown("loop", place.loc));
      }
      const block = this.#getBlock(currentId);
      if (!isPhiResolved && (!isLoopHeader || this.#unrolledLoopHeaders.has(currentId)))
        this.#resolveBlockPhis(block, previousId, currentPathState.guards);
      for (const instruction of block.instructions) {
        this.#interpreter.evaluateInstruction(instruction, currentPathState);
        if (instruction.value.kind === "Await")
          currentPathState = this.#passAwait(currentPathState, instruction.loc);
      }
      const step = this.#walkTerminal(block.terminal, currentId, stops, currentPathState);
      if (step.kind !== "Next") return step;
      previousId = currentId;
      currentId = step.block;
      isPhiResolved = false;
    }
  }

  #resolveBlockPhis(block: BasicBlock, from: BlockId | null, guards: SymbolicValue[]): void {
    for (const phi of block.phis)
      this.#interpreter.write(
        phi.place,
        this.#resolvePhi(phi, { kind: "Fallthrough", from, to: block.id }, guards),
      );
  }

  #walkTerminal(
    terminal: Terminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): TerminalStep {
    switch (terminal.kind) {
      case "return":
        return this.#return(this.#interpreter.read(terminal.value));
      case "throw":
      case "unreachable":
      case "unsupported":
        return { kind: "Return", value: createUnknown(terminal.kind, terminal.loc) };
      case "goto":
        return stops.has(terminal.block)
          ? this.#fallthrough(blockId, terminal.block)
          : { kind: "Next", block: terminal.block };
      case "if":
      case "branch":
        return this.#walkBranch(terminal, blockId, stops, pathState);
      case "switch":
        return this.#walkSwitch(terminal, blockId, stops, pathState);
      case "ternary":
      case "logical":
      case "optional":
        return this.#walkValueBranch(terminal, blockId, stops, pathState);
      case "try":
        this.functionScope.catchBindings.set(terminal.handler, terminal.handlerBinding);
        return this.#interpreter.handlerEffects
          ? this.#walkTryInHandler(terminal, blockId, stops, pathState)
          : { kind: "Next", block: terminal.block };
      case "label":
      case "sequence":
      case "scope":
      case "pruned-scope":
        return { kind: "Next", block: terminal.block };
      case "maybe-throw":
        return this.#walkMaybeThrow(terminal, blockId, stops, pathState);
      case "for":
      case "for-of":
      case "for-in":
      case "while":
      case "do-while":
        return this.#walkLoop(terminal, blockId, stops, pathState);
      default:
        return assertExhaustive(terminal, "Unhandled terminal");
    }
  }

  #walkValueBranch(
    terminal: ValueBranchTerminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): Completion {
    this.#interpreter
      .getCompilationTables()
      .branchOperators.set(terminal.fallthrough, getBranchOperator(terminal));
    const testCompletion = this.walk(
      terminal.test,
      new Set([...stops, terminal.fallthrough]),
      blockId,
      pathState,
      "unresolved",
    );
    return this.#continueAfter(testCompletion, terminal.fallthrough, stops, pathState);
  }

  #walkMaybeThrow(
    terminal: MaybeThrowTerminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): TerminalStep {
    if (terminal.value !== null && terminal.handler !== null)
      return this.#walkCaughtThrow(terminal.value, terminal.handler, blockId, stops);
    if (this.#interpreter.handlerEffects && terminal.handler !== null)
      this.#throwingCatches.add(terminal.handler);
    if (
      this.#interpreter.handlerEffects ||
      terminal.handler === null ||
      this.functionScope.walkedCatches.has(terminal.handler)
    )
      return { kind: "Next", block: terminal.continuation };
    this.functionScope.walkedCatches.add(terminal.handler);
    const throwTest = createUnknown("throws", terminal.loc);
    const places = this.#getTrackedContextPlaces();
    const valuesBefore = places.map((place) => this.#interpreter.read(place));
    const consequent = this.#walkSuccessor(terminal.handler, blockId, stops, pathState, throwTest);
    places.forEach((place, index) => this.#interpreter.write(place, valuesBefore[index]));
    return {
      kind: "Split",
      test: throwTest,
      testKind: "truthy",
      branch: this.#interpreter.createBranchSite(terminal.loc),
      consequent,
      alternate: this.#walkSuccessor(
        terminal.continuation,
        blockId,
        stops,
        pathState,
        negate(throwTest),
      ),
    };
  }

  #walkCaughtThrow(
    value: Place,
    handler: BlockId,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
  ): TerminalStep {
    const handlerBinding = this.functionScope.catchBindings.get(handler);
    if (handlerBinding) this.#interpreter.write(handlerBinding, this.#interpreter.read(value));
    return stops.has(handler)
      ? this.#fallthrough(blockId, handler)
      : { kind: "Next", block: handler };
  }

  #passAwait(pathState: PathState, loc: SourceLocation): PathState {
    this.#awaitCount++;
    this.#interpreter.cells.passAwait();
    const asyncPathState = getAsyncPathState(pathState);
    const throwPoints = this.functionScope.throwPointsByTry.at(-1);
    if (!throwPoints) return asyncPathState;
    const test = createUnknown("throws", loc);
    throwPoints.push({ pathState: asyncPathState, test });
    return { ...asyncPathState, guards: [...asyncPathState.guards, negate(test)] };
  }

  #walkTryInHandler(
    terminal: TryTerminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    pathState: PathState,
  ): Completion {
    const bodyStops = new Set([...stops, terminal.fallthrough]);
    const awaitCountBefore = this.#awaitCount;
    const throwPoints: ThrowPoint[] = [];
    this.functionScope.throwPointsByTry.push(throwPoints);
    const bodyCompletion = this.walk(terminal.block, bodyStops, blockId, pathState, "unresolved");
    this.functionScope.throwPointsByTry.pop();
    const afterPathState =
      this.#awaitCount > awaitCountBefore ? getAsyncPathState(pathState) : pathState;
    if (!this.#throwingCatches.delete(terminal.handler))
      return this.#continueAfter(bodyCompletion, terminal.fallthrough, stops, afterPathState);
    if (throwPoints.length === 0)
      throwPoints.push({ pathState: afterPathState, test: createUnknown("throws", terminal.loc) });
    const branch = this.#interpreter.createBranchSite(terminal.loc);
    const catchPaths = throwPoints.map((throwPoint) => ({
      test: throwPoint.test,
      completion: this.#walkSuccessor(
        terminal.handler,
        blockId,
        bodyStops,
        throwPoint.pathState,
        throwPoint.test,
      ),
    }));
    const completion = catchPaths.reduceRight<Completion>(
      (alternate, catchPath) => ({
        kind: "Split",
        test: catchPath.test,
        testKind: "truthy",
        branch,
        consequent: catchPath.completion,
        alternate,
      }),
      bodyCompletion,
    );
    return this.#continueAfter(completion, terminal.fallthrough, stops, afterPathState);
  }

  getCompletionValue(
    completion: Completion,
    loc: SourceLocation,
    guards: SymbolicValue[],
  ): SymbolicValue {
    switch (completion.kind) {
      case "Return":
        return completion.value;
      case "Fallthrough":
        return createUnknown("fallthrough", loc);
      case "Split":
        return createConditional(completion, guards, (edge, edgeGuards) =>
          this.getCompletionValue(edge, loc, edgeGuards),
        );
      default:
        return assertExhaustive(completion, "Unhandled completion");
    }
  }
}
