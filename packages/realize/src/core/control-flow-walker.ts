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
} from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import {
  eachInstructionLValue,
  eachInstructionOperand,
  eachTerminalOperand,
  eachTerminalSuccessor,
} from "../react-compiler/HIR/visitors";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type { Binding, Branch, SymbolicValue, TestKind } from "./types";
import {
  createConditional,
  getBranchKey,
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
  FallthroughOutcome,
  LoopTerminal,
  Outcome,
  SplitOutcome,
  SwitchTerminal,
} from "./control-flow";
import {
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  foldBinary,
  getKnownOutcome,
  getShortCircuit,
} from "./symbolic-values";
import { PlaceMap } from "./utils/place-map";
import { getDeclarationLocation } from "./utils/get-declaration-location";
import { getIdentifierName } from "./utils/get-identifier-name";
import { getTestExpression } from "./utils/get-test-expression";
import { negate } from "./utils/negate";
import type { Interpreter } from "./interpret";
import { getAsyncWalkState } from "./walk-state";
import type { WalkState } from "./walk-state";

export type BranchOperator = "ternary" | "&&" | "||" | "??" | "optional" | "optional-chain-tail";

type ValueBranchTerminal = Extract<Terminal, { kind: "ternary" | "logical" | "optional" }>;

type MaybeThrowTerminal = Extract<Terminal, { kind: "maybe-throw" }>;

type TryTerminal = Extract<Terminal, { kind: "try" }>;

type PhiState = "resolved" | "unresolved";

interface NextStep {
  kind: "Next";
  block: BlockId;
}

type TerminalStep = Outcome | NextStep;

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
  outcome: Outcome,
  block: BlockId,
  guards: SymbolicValue[] = [],
): SymbolicValue => {
  if (outcome.kind !== "Split")
    return { kind: "Primitive", value: outcome.kind === "Fallthrough" && outcome.to === block };
  const conditional = createConditional(outcome, guards, (arm, armGuards) =>
    getReachTest(arm, block, armGuards),
  );
  const { consequent, alternate } = conditional;
  const isUndecided =
    consequent.kind !== "Primitive" ||
    alternate.kind !== "Primitive" ||
    consequent.value !== alternate.value;
  return isUndecided ? conditional : consequent;
};

const getBranchOperator = (terminal: ValueBranchTerminal): BranchOperator => {
  if (terminal.kind === "logical") return terminal.operator;
  if (terminal.kind === "optional" && !terminal.optional) return "optional-chain-tail";
  return terminal.kind;
};

interface ThrowPoint {
  walkState: WalkState;
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
  #blockVisits = 0;
  #walkDepth = 0;
  #loopDepth = 0;
  readonly #enteredLoopHeaders = new Map<BlockId, boolean>();
  readonly #loopContextPlaces = new Map<BlockId, Place[]>();
  readonly #unrolledLoopHeaders = new Set<BlockId>();
  readonly #trackedContextPlaces = new WeakMap<HIRFunction, Place[]>();
  #functionScope = createFunctionScope();
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

  get blockVisits(): number {
    return this.#blockVisits;
  }

  set blockVisits(blockVisits: number) {
    this.#blockVisits = blockVisits;
  }

  get functionScope(): FunctionScope {
    return this.#functionScope;
  }

  set functionScope(functionScope: FunctionScope) {
    this.#functionScope = functionScope;
  }

  #resolvePhi(phi: Phi, outcome: Outcome, guards: SymbolicValue[]): SymbolicValue {
    switch (outcome.kind) {
      case "Fallthrough": {
        const operand = outcome.from === null ? undefined : phi.operands.get(outcome.from);
        return operand ? this.#interpreter.read(operand) : createUnknown("loop", phi.place.loc);
      }
      case "Split":
        return createConditional(outcome, guards, (arm, armGuards) =>
          this.#resolvePhi(phi, arm, armGuards),
        );
      case "Return":
        return createUnknown("unreachable", phi.place.loc);
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  #continueAfter(
    outcome: Outcome,
    join: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
    joinPhiState: PhiState = "unresolved",
  ): Outcome {
    if (stops.has(join)) return outcome;
    const block = this.#getBlock(join);
    if (isFallthroughOnly(outcome, join)) {
      if (joinPhiState === "unresolved")
        for (const phi of block.phis)
          this.#interpreter.write(phi.place, this.#resolvePhi(phi, outcome, walkState.guards));
      this.#mergeContextValues(outcome, join, walkState.guards);
      return this.walk(join, stops, null, walkState, "resolved");
    }
    const resumeAtJoin = (arm: Outcome, guards: SymbolicValue[]): Outcome => {
      switch (arm.kind) {
        case "Return":
          return arm;
        case "Fallthrough":
          if (arm.to !== join) return arm;
          this.#restoreContextValues(arm);
          return this.walk(join, stops, arm.from, { ...walkState, guards }, joinPhiState);
        case "Split":
          return this.#nestWalk(() => ({
            ...arm,
            consequent: resumeAtJoin(arm.consequent, [...guards, getGuard(arm, true)]),
            alternate: resumeAtJoin(arm.alternate, [...guards, getGuard(arm, false)]),
          }));
        default:
          return assertExhaustive(arm, "Unhandled outcome");
      }
    };
    return hasFallthrough(outcome, join) ? resumeAtJoin(outcome, walkState.guards) : outcome;
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
    walkState: WalkState,
  ): Outcome {
    const { consequent, alternate, fallthrough } = terminal;
    const operator =
      this.#interpreter.getCompilationTables().branchOperators.get(fallthrough) ?? "ternary";
    const branchTest = getBranchTest(operator, this.#interpreter.read(terminal.test));
    const testGuard = getTestExpression(branchTest);
    const armStops = new Set([...stops, fallthrough]);
    const isSwapped = operator === "&&";
    const consequentGuard = isSwapped ? negate(testGuard) : testGuard;
    const probe = this.#interpreter.resolver.isExpression(terminal.test.loc)
      ? branchTest.testKind
      : "none";
    const branch = this.#interpreter.createBranch(terminal.id, terminal.test.loc, probe);
    const walkConsequent = () =>
      this.#walkArm(consequent, from, armStops, walkState, consequentGuard);
    const walkAlternate = () =>
      this.#walkArm(alternate, from, armStops, walkState, negate(consequentGuard));
    if (branchTest.knownOutcome !== null) {
      this.#recordDecidedBranch(branch, branchTest.knownOutcome);
      const takenArm = branchTest.knownOutcome !== isSwapped ? consequent : alternate;
      return this.#continueAfter(
        this.#walkArm(takenArm, from, armStops, walkState, null),
        fallthrough,
        stops,
        walkState,
      );
    }
    const storedPlaces = this.#getArmStoredContextPlaces([consequent, alternate], fallthrough);
    const valuesBefore = storedPlaces.map((place) => this.#interpreter.read(place));
    const consequentOutcome = walkConsequent();
    const consequentValues = storedPlaces.map((place) => this.#interpreter.read(place));
    storedPlaces.forEach((place, index) => this.#interpreter.write(place, valuesBefore[index]));
    const alternateOutcome = walkAlternate();
    const splitOutcome: SplitOutcome = {
      kind: "Split",
      test: branchTest.test,
      testKind: branchTest.testKind,
      branch,
      consequent: isSwapped ? alternateOutcome : consequentOutcome,
      alternate: isSwapped ? consequentOutcome : alternateOutcome,
    };
    storedPlaces.forEach((place, index) => {
      const consequentValue = consequentValues[index] ?? UNDEFINED_VALUE;
      const alternateValue = this.#interpreter.read(place);
      if (consequentValue === alternateValue) return;
      const valuesByArm = new Map<Outcome, SymbolicValue>([
        [consequentOutcome, consequentValue],
        [alternateOutcome, alternateValue],
      ]);
      this.#interpreter.write(
        place,
        createConditional(
          splitOutcome,
          walkState.guards,
          (arm) => valuesByArm.get(arm) ?? alternateValue,
        ),
      );
    });
    return this.#continueAfter(splitOutcome, fallthrough, stops, walkState);
  }

  #recordDecidedBranch(branch: Branch, outcome: boolean): void {
    const branchKey = getBranchKey(branch);
    const outcomes = this.#interpreter.decidedBranchOutcomes.get(branchKey) ?? [];
    if (!outcomes.includes(outcome))
      this.#interpreter.decidedBranchOutcomes.set(branchKey, [...outcomes, outcome]);
  }

  #walkArm(
    armBlock: BlockId,
    from: BlockId,
    armStops: ReadonlySet<BlockId>,
    walkState: WalkState,
    guard: SymbolicValue | null,
  ): Outcome {
    if (armStops.has(armBlock)) return this.#fallthrough(from, armBlock);
    const guards = guard ? [...walkState.guards, guard] : walkState.guards;
    return this.walk(armBlock, armStops, from, { ...walkState, guards }, "unresolved");
  }

  #walkSwitch(
    terminal: SwitchTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome {
    const switchWalk: SwitchWalk = {
      terminal,
      from,
      discriminant: this.#interpreter.read(terminal.test),
    };
    const caseBlocks = [...new Set(terminal.cases.map((switchCase) => switchCase.block))].filter(
      (block) => block !== terminal.fallthrough,
    );
    const casesOutcome = caseBlocks.reduce(
      (outcome, block) =>
        this.#continueAtCase(
          outcome,
          block,
          new Set([
            ...stops,
            terminal.fallthrough,
            ...caseBlocks.filter((caseBlock) => caseBlock !== block),
          ]),
          walkState,
        ),
      this.#dispatchSwitchCase(switchWalk, 0),
    );
    return this.#continueAfter(casesOutcome, terminal.fallthrough, stops, walkState);
  }

  #dispatchSwitchCase(switchWalk: SwitchWalk, caseIndex: number): Outcome {
    const { terminal, from, discriminant } = switchWalk;
    const switchCase = terminal.cases[caseIndex];
    if (!switchCase) {
      const defaultCase = terminal.cases.find((candidate) => candidate.test === null);
      return this.#fallthrough(from, defaultCase?.block ?? terminal.fallthrough);
    }
    if (switchCase.test === null) return this.#dispatchSwitchCase(switchWalk, caseIndex + 1);
    const caseTest = foldBinary("===", discriminant, this.#interpreter.read(switchCase.test));
    const matched: Outcome = this.#fallthrough(from, switchCase.block);
    if (caseTest.kind === "Primitive")
      return caseTest.value ? matched : this.#dispatchSwitchCase(switchWalk, caseIndex + 1);
    return {
      kind: "Split",
      test: caseTest,
      testKind: "truthy",
      branch: this.#interpreter.createBranch(terminal.id, switchCase.test.loc, "none"),
      consequent: matched,
      alternate: this.#dispatchSwitchCase(switchWalk, caseIndex + 1),
    };
  }

  #continueAtCase(
    outcome: Outcome,
    block: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome {
    const predecessors = new Set<BlockId | null>();
    mapFallthroughs(outcome, (fallthrough) => {
      if (fallthrough.to === block) predecessors.add(fallthrough.from);
      return fallthrough;
    });
    if (predecessors.size < 2) return this.#continueAfter(outcome, block, stops, walkState);
    for (const phi of this.#getBlock(block).phis)
      this.#interpreter.write(phi.place, this.#resolvePhi(phi, outcome, walkState.guards));
    this.#mergeContextValues(outcome, block, walkState.guards);
    const reachTest = getReachTest(outcome, block);
    const caseWalkState =
      reachTest.kind === "Primitive"
        ? walkState
        : { ...walkState, guards: [...walkState.guards, reachTest] };
    const blockOutcome = this.walk(block, stops, null, caseWalkState, "resolved");
    return mapFallthroughs(outcome, (fallthrough) =>
      fallthrough.to === block ? blockOutcome : fallthrough,
    );
  }

  #walkLoop(
    terminal: LoopTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome {
    const unrolledOutcome = this.#unrollLoop(terminal, from, stops, walkState);
    if (unrolledOutcome) return unrolledOutcome;
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
    let bodyOutcome: Outcome;
    try {
      bodyOutcome = this.walk(
        loopEntry,
        new Set([...stops, terminal.fallthrough]),
        null,
        walkState,
        "resolved",
      );
    } finally {
      this.#loopDepth--;
      for (const loopHeader of loopHeaders) {
        this.#enteredLoopHeaders.delete(loopHeader);
        this.#loopContextPlaces.delete(loopHeader);
      }
    }
    const loopExit: Outcome = {
      kind: "Fallthrough",
      from: getLoopExit(terminal),
      to: terminal.fallthrough,
    };
    const exitOutcome = collapseLoopSplits(
      mapFallthroughs(bodyOutcome, (fallthrough) =>
        fallthrough.to === terminal.fallthrough || loopHeaders.includes(fallthrough.to)
          ? loopExit
          : fallthrough,
      ),
      loopBindings,
      terminal.loc,
    );
    const exitValueOutcome = collapseLoopSplits(
      mapFallthroughs(bodyOutcome, (fallthrough) =>
        loopHeaders.includes(fallthrough.to) ? loopExit : fallthrough,
      ),
      loopBindings,
      terminal.loc,
    );
    for (const phi of this.#getBlock(terminal.fallthrough).phis)
      this.#interpreter.write(
        phi.place,
        this.#createLoopValue(
          phi,
          loopBindings,
          this.#resolvePhi(phi, exitValueOutcome, walkState.guards),
        ),
      );
    this.#addLoopInputPlaces(
      loopBindings.slice(headerBindingCount),
      loopEntry,
      terminal.fallthrough,
    );
    for (const place of storedContextPlaces)
      this.#interpreter.write(place, createUnknown("loop", place.loc));
    const afterWalkState =
      this.#awaitCount > awaitCountBefore ? getAsyncWalkState(walkState) : walkState;
    return this.#continueAfter(
      exitOutcome,
      terminal.fallthrough,
      stops,
      afterWalkState,
      "resolved",
    );
  }

  #unrollLoop(
    terminal: LoopTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome | null {
    const loopHeaders = getLoopHeaders(terminal);
    const [loopEntry = terminal.fallthrough] = loopHeaders;
    const isUnrollable = this.#getLoopBlocks(loopEntry, terminal.fallthrough).every(
      (block) =>
        UNROLLABLE_TERMINALS.has(block.terminal.kind) &&
        block.instructions.every((instruction) =>
          UNROLLABLE_INSTRUCTIONS.has(instruction.value.kind),
        ),
    );
    if (!isUnrollable) return null;
    const loopStops = new Set([...stops, terminal.fallthrough]);
    for (const loopHeader of loopHeaders) this.#unrolledLoopHeaders.add(loopHeader);
    let outcome: Outcome = { kind: "Fallthrough", from, to: loopEntry };
    try {
      for (let iteration = 0; outcome.kind === "Fallthrough"; iteration++) {
        const header = outcome.to;
        if (!loopHeaders.includes(header)) break;
        if (iteration > MAX_UNROLLED_ITERATIONS) return null;
        const headerBlock = this.#getBlock(header);
        if (outcome.from !== null)
          this.#resolveBlockPhis(headerBlock, outcome.from, walkState.guards);
        for (const phi of headerBlock.phis)
          if (this.#interpreter.read(phi.place).kind !== "Primitive") return null;
        for (const loopHeader of loopHeaders) this.#enteredLoopHeaders.set(loopHeader, false);
        outcome = this.walk(header, loopStops, outcome.from, walkState, "resolved");
      }
    } finally {
      for (const loopHeader of loopHeaders) {
        this.#unrolledLoopHeaders.delete(loopHeader);
        this.#enteredLoopHeaders.delete(loopHeader);
      }
    }
    if (outcome.kind === "Split") return null;
    return this.#continueAfter(outcome, terminal.fallthrough, stops, walkState);
  }

  #getLoopBlocks(loopEntry: BlockId, loopFallthrough: BlockId): BasicBlock[] {
    const visitedBlocks = new Set([loopEntry, loopFallthrough]);
    const loopBlocks = [this.#getBlock(loopEntry)];
    for (const block of loopBlocks)
      for (const successor of eachTerminalSuccessor(block.terminal)) {
        if (visitedBlocks.has(successor)) continue;
        visitedBlocks.add(successor);
        loopBlocks.push(this.#getBlock(successor));
      }
    return loopBlocks;
  }

  #getTrackedContextPlaces(): Place[] {
    const hirFunction = this.#interpreter.getCurrentFunction();
    const cached = this.#trackedContextPlaces.get(hirFunction);
    if (cached) return cached;
    const placesById = new Map<IdentifierId, Place>();
    for (const block of hirFunction.body.blocks.values())
      for (const { value } of block.instructions) {
        if (value.kind === "StoreContext")
          placesById.set(value.lvalue.place.identifier.id, value.lvalue.place);
        if (value.kind === "PostfixUpdateContext" || value.kind === "PrefixUpdateContext")
          placesById.set(value.lvalue.identifier.id, value.lvalue);
      }
    const places = [...placesById.values()];
    this.#trackedContextPlaces.set(hirFunction, places);
    return places;
  }

  #fallthrough(from: BlockId | null, to: BlockId): FallthroughOutcome {
    const places = this.#getTrackedContextPlaces();
    if (places.length === 0) return { kind: "Fallthrough", from, to };
    const contextValues = new Map(
      places.map((place): [IdentifierId, ContextValue] => [
        place.identifier.id,
        { place, value: this.#interpreter.read(place) },
      ]),
    );
    return { kind: "Fallthrough", from, to, contextValues };
  }

  #restoreContextValues(fallthrough: FallthroughOutcome): void {
    for (const { place, value } of fallthrough.contextValues?.values() ?? [])
      this.#interpreter.write(place, value);
  }

  #mergeContextValues(outcome: Outcome, join: BlockId, guards: SymbolicValue[]): void {
    for (const place of this.#getTrackedContextPlaces()) {
      const merged = this.#getJoinedContextValue(outcome, join, place.identifier.id, guards);
      if (merged) this.#interpreter.write(place, merged);
    }
  }

  #getJoinedContextValue(
    outcome: Outcome,
    join: BlockId,
    id: IdentifierId,
    guards: SymbolicValue[],
  ): SymbolicValue | null {
    if (outcome.kind === "Return") return null;
    if (outcome.kind === "Fallthrough")
      return outcome.to === join ? (outcome.contextValues?.get(id)?.value ?? null) : null;
    const consequent = this.#getJoinedContextValue(outcome.consequent, join, id, guards);
    const alternate = this.#getJoinedContextValue(outcome.alternate, join, id, guards);
    if (!consequent || !alternate || consequent === alternate) return consequent ?? alternate;
    return createConditional(outcome, guards, (arm) =>
      arm === outcome.consequent ? consequent : alternate,
    );
  }

  #getArmStoredContextPlaces(entries: BlockId[], exit: BlockId): Place[] {
    const placesById = new Map<IdentifierId, Place>();
    for (const entry of entries)
      for (const place of this.#getStoredContextPlaces(entry, exit))
        placesById.set(place.identifier.id, place);
    return [...placesById.values()];
  }

  #getStoredContextPlaces(entry: BlockId, exit: BlockId): Place[] {
    const places: Place[] = [];
    const visited = new Set<BlockId>();
    const pending = [entry];
    for (let blockId = pending.pop(); blockId !== undefined; blockId = pending.pop()) {
      if (blockId === exit || visited.has(blockId)) continue;
      visited.add(blockId);
      const block = this.#getBlock(blockId);
      for (const { value } of block.instructions) {
        if (value.kind === "StoreContext") places.push(value.lvalue.place);
        if (value.kind === "PostfixUpdateContext" || value.kind === "PrefixUpdateContext")
          places.push(value.lvalue);
      }
      pending.push(...eachTerminalSuccessor(block.terminal));
    }
    return places;
  }

  #createLoopValue(
    phi: Phi,
    loopBindings: Binding[],
    alias: SymbolicValue | null = null,
  ): SymbolicValue {
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
      alias,
    });
    if (!loopBindings.includes(binding)) loopBindings.push(binding);
    return createBindingValue(binding);
  }

  #addLoopInputPlaces(loopBindings: Binding[], loopEntry: BlockId, loopFallthrough: BlockId): void {
    if (loopBindings.length === 0) return;
    const loopBlocks = this.#getLoopBlocks(loopEntry, loopFallthrough);
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
    walkState: WalkState,
    entryPhiState: PhiState,
  ): Outcome {
    return this.#nestWalk(() => this.#walkBlocks(blockId, stops, from, walkState, entryPhiState));
  }

  #nestWalk(walkNested: () => Outcome): Outcome {
    if (this.#walkDepth >= MAX_WALK_DEPTH) return this.#bailOutTooComplex("nests too many blocks");
    this.#walkDepth++;
    try {
      return walkNested();
    } finally {
      this.#walkDepth--;
    }
  }

  #bailOutTooComplex(message: string): Outcome {
    this.#interpreter.diagnostics.bailOut("too-complex", message, GeneratedSource);
    return { kind: "Return", value: createUnknown("too-complex", GeneratedSource) };
  }

  #walkBlocks(
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    from: BlockId | null,
    walkState: WalkState,
    entryPhiState: PhiState,
  ): Outcome {
    let currentId = blockId;
    let previousId = from;
    let isPhiResolved = entryPhiState === "resolved";
    let currentWalkState = walkState;
    while (true) {
      if (++this.#blockVisits > MAX_BLOCK_VISITS)
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
        this.#resolveBlockPhis(block, previousId, currentWalkState.guards);
      for (const instruction of block.instructions) {
        this.#interpreter.evaluateInstruction(instruction, currentWalkState);
        if (instruction.value.kind === "Await")
          currentWalkState = this.#passAwait(currentWalkState, instruction.loc);
      }
      const step = this.#walkTerminal(block.terminal, currentId, stops, currentWalkState);
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
    walkState: WalkState,
  ): TerminalStep {
    switch (terminal.kind) {
      case "return":
        return { kind: "Return", value: this.#interpreter.read(terminal.value) };
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
        return this.#walkBranch(terminal, blockId, stops, walkState);
      case "switch":
        return this.#walkSwitch(terminal, blockId, stops, walkState);
      case "ternary":
      case "logical":
      case "optional":
        return this.#walkValueBranch(terminal, blockId, stops, walkState);
      case "try":
        this.#functionScope.catchBindings.set(terminal.handler, terminal.handlerBinding);
        return this.#interpreter.handlerEffects
          ? this.#walkTryInHandler(terminal, blockId, stops, walkState)
          : { kind: "Next", block: terminal.block };
      case "label":
      case "sequence":
      case "scope":
      case "pruned-scope":
        return { kind: "Next", block: terminal.block };
      case "maybe-throw":
        return this.#walkMaybeThrow(terminal, blockId, stops, walkState);
      case "for":
      case "for-of":
      case "for-in":
      case "while":
      case "do-while":
        return this.#walkLoop(terminal, blockId, stops, walkState);
      default:
        return assertExhaustive(terminal, "Unhandled terminal");
    }
  }

  #walkValueBranch(
    terminal: ValueBranchTerminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome {
    this.#interpreter
      .getCompilationTables()
      .branchOperators.set(terminal.fallthrough, getBranchOperator(terminal));
    const testOutcome = this.walk(
      terminal.test,
      new Set([...stops, terminal.fallthrough]),
      blockId,
      walkState,
      "unresolved",
    );
    return this.#continueAfter(testOutcome, terminal.fallthrough, stops, walkState);
  }

  #walkMaybeThrow(
    terminal: MaybeThrowTerminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): TerminalStep {
    const { handler, continuation } = terminal;
    if (terminal.value !== null && handler !== null)
      return this.#walkCaughtThrow(terminal.value, handler, blockId, stops);
    if (this.#interpreter.handlerEffects && handler !== null) this.#throwingCatches.add(handler);
    const { walkedCatches } = this.#functionScope;
    if (this.#interpreter.handlerEffects || handler === null || walkedCatches.has(handler))
      return { kind: "Next", block: continuation };
    walkedCatches.add(handler);
    const throwTest = createUnknown("throws", terminal.loc);
    return {
      kind: "Split",
      test: throwTest,
      testKind: "truthy",
      branch: this.#interpreter.createBranch(terminal.id, terminal.loc, "none"),
      consequent: this.#walkArm(handler, blockId, stops, walkState, throwTest),
      alternate: this.#walkArm(continuation, blockId, stops, walkState, negate(throwTest)),
    };
  }

  #walkCaughtThrow(
    value: Place,
    handler: BlockId,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
  ): TerminalStep {
    const handlerBinding = this.#functionScope.catchBindings.get(handler);
    if (handlerBinding) this.#interpreter.write(handlerBinding, this.#interpreter.read(value));
    return stops.has(handler)
      ? this.#fallthrough(blockId, handler)
      : { kind: "Next", block: handler };
  }

  #passAwait(walkState: WalkState, loc: SourceLocation): WalkState {
    this.#awaitCount++;
    this.#interpreter.cells.passAwait();
    const asyncWalkState = getAsyncWalkState(walkState);
    const throwPoints = this.#functionScope.throwPointsByTry.at(-1);
    if (!throwPoints) return asyncWalkState;
    const test = createUnknown("throws", loc);
    throwPoints.push({ walkState: asyncWalkState, test });
    return { ...asyncWalkState, guards: [...asyncWalkState.guards, negate(test)] };
  }

  #walkTryInHandler(
    terminal: TryTerminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome {
    const { block, handler, fallthrough } = terminal;
    const bodyStops = new Set([...stops, fallthrough]);
    const awaitCountBefore = this.#awaitCount;
    const throwPoints: ThrowPoint[] = [];
    this.#functionScope.throwPointsByTry.push(throwPoints);
    const bodyOutcome = this.walk(block, bodyStops, blockId, walkState, "unresolved");
    this.#functionScope.throwPointsByTry.pop();
    const afterWalkState =
      this.#awaitCount > awaitCountBefore ? getAsyncWalkState(walkState) : walkState;
    if (!this.#throwingCatches.delete(handler))
      return this.#continueAfter(bodyOutcome, fallthrough, stops, afterWalkState);
    if (throwPoints.length === 0)
      throwPoints.push({ walkState: afterWalkState, test: createUnknown("throws", terminal.loc) });
    const branch = this.#interpreter.createBranch(terminal.id, terminal.loc, "none");
    const catchArms = throwPoints.map(({ walkState: throwWalkState, test }) => ({
      test,
      outcome: this.#walkArm(handler, blockId, bodyStops, throwWalkState, test),
    }));
    const outcome = catchArms.reduceRight<Outcome>(
      (alternate, { test, outcome: consequent }) => ({
        kind: "Split",
        test,
        testKind: "truthy",
        branch,
        consequent,
        alternate,
      }),
      bodyOutcome,
    );
    return this.#continueAfter(outcome, fallthrough, stops, afterWalkState);
  }

  getOutcomeValue(outcome: Outcome, loc: SourceLocation, guards: SymbolicValue[]): SymbolicValue {
    switch (outcome.kind) {
      case "Return":
        return outcome.value;
      case "Fallthrough":
        return createUnknown("fallthrough", loc);
      case "Split":
        return createConditional(outcome, guards, (arm, armGuards) =>
          this.getOutcomeValue(arm, loc, armGuards),
        );
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }
}
