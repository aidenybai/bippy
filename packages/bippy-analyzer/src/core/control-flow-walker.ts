import type {
  BasicBlock,
  BlockId,
  Phi,
  Place,
  SourceLocation,
  Terminal,
} from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import { eachTerminalSuccessor } from "../react-compiler/HIR/visitors";
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
import type { BranchTerminal, LoopTerminal, Outcome, SwitchTerminal } from "./control-flow";
import {
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
  #functionScope = createFunctionScope();
  readonly #throwingCatches = new Set<BlockId>();
  #awaitCount = 0;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  get loopDepth(): number {
    return this.#loopDepth;
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
      return this.walk(join, stops, null, walkState, "resolved");
    }
    const resumeAtJoin = (arm: Outcome, guards: SymbolicValue[]): Outcome => {
      switch (arm.kind) {
        case "Return":
          return arm;
        case "Fallthrough":
          return arm.to === join
            ? this.walk(join, stops, arm.from, { ...walkState, guards }, joinPhiState)
            : arm;
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
    const consequentOutcome = this.#walkArm(consequent, from, armStops, walkState, consequentGuard);
    const alternateOutcome = this.#walkArm(
      alternate,
      from,
      armStops,
      walkState,
      negate(consequentGuard),
    );
    const probe = this.#interpreter.resolver.isExpression(terminal.test.loc)
      ? branchTest.testKind
      : "none";
    const branch = this.#interpreter.createBranch(terminal.id, terminal.test.loc, probe);
    if (branchTest.knownOutcome !== null) {
      this.#recordDecidedBranch(branch, branchTest.knownOutcome);
      return this.#continueAfter(
        branchTest.knownOutcome !== isSwapped ? consequentOutcome : alternateOutcome,
        fallthrough,
        stops,
        walkState,
      );
    }
    const splitOutcome: Outcome = {
      kind: "Split",
      test: branchTest.test,
      testKind: branchTest.testKind,
      branch,
      consequent: isSwapped ? alternateOutcome : consequentOutcome,
      alternate: isSwapped ? consequentOutcome : alternateOutcome,
    };
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
    guard: SymbolicValue,
  ): Outcome {
    if (armStops.has(armBlock)) return { kind: "Fallthrough", from, to: armBlock };
    const guards = [...walkState.guards, guard];
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
      return { kind: "Fallthrough", from, to: defaultCase?.block ?? terminal.fallthrough };
    }
    if (switchCase.test === null) return this.#dispatchSwitchCase(switchWalk, caseIndex + 1);
    const caseTest = foldBinary("===", discriminant, this.#interpreter.read(switchCase.test));
    const matched: Outcome = { kind: "Fallthrough", from, to: switchCase.block };
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
    const blockOutcome = this.walk(block, stops, null, walkState, "resolved");
    return mapFallthroughs(outcome, (fallthrough) =>
      fallthrough.to === block ? blockOutcome : fallthrough,
    );
  }

  #walkLoop(terminal: LoopTerminal, stops: ReadonlySet<BlockId>, walkState: WalkState): Outcome {
    const loopHeaders = getLoopHeaders(terminal);
    const loopBindings: Binding[] = [];
    for (const loopHeader of loopHeaders) {
      this.#enteredLoopHeaders.set(loopHeader, false);
      for (const phi of this.#getBlock(loopHeader).phis)
        this.#interpreter.write(phi.place, this.#createLoopValue(phi, loopBindings));
    }
    const [loopEntry = terminal.fallthrough] = loopHeaders;
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
      for (const loopHeader of loopHeaders) this.#enteredLoopHeaders.delete(loopHeader);
    }
    for (const phi of this.#getBlock(terminal.fallthrough).phis)
      this.#interpreter.write(phi.place, this.#createLoopValue(phi, loopBindings));
    this.#addLoopInputPlaces(loopBindings, loopEntry, terminal.fallthrough);
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
    const inputPlaces = new PlaceMap<true>();
    const visitedBlocks = new Set([loopEntry, loopFallthrough]);
    const pendingBlocks = [loopEntry];
    for (const blockId of pendingBlocks) {
      const block = this.#getBlock(blockId);
      for (const instruction of block.instructions)
        this.#interpreter.collectInputPlaces(
          this.#interpreter.read(instruction.lvalue),
          inputPlaces,
        );
      for (const successor of eachTerminalSuccessor(block.terminal)) {
        if (visitedBlocks.has(successor)) continue;
        visitedBlocks.add(successor);
        pendingBlocks.push(successor);
      }
    }
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
      }
      const block = this.#getBlock(currentId);
      if (!isPhiResolved && !isLoopHeader)
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
          ? { kind: "Fallthrough", from: blockId, to: terminal.block }
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
        return this.#walkLoop(terminal, stops, walkState);
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
      ? { kind: "Fallthrough", from: blockId, to: handler }
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
