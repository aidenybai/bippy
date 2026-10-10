/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/HIRBuilder.ts at b618bbb.

/*
 * Binding resolution over the TypeScript 7 AST
 *
 * Babel's `path.scope` does not exist here. `ScopeManager` (./scope.ts) replaces it: build one
 * per SourceFile with `new ScopeManager(sourceFile)` and pass it to the Environment, which
 * exposes it as `env.scopes`. All identity is by TS7 node object, so always use nodes from the
 * same SourceFile instance.
 *
 *   Babel                                   TS7
 *   path.scope                              env.scopes.getScope(node)
 *   scope.parent                            scope.parent
 *   scope.bindings                          scope.bindings (Map<string, Binding>)
 *   path.scope.getBinding(name)             env.scopes.getBinding(env.scopes.getScope(node), name)
 *   binding for an Identifier path          env.scopes.resolveIdentifier(identifierNode)
 *   binding.identifier                      binding.identifier (the declaring Identifier node)
 *   binding.kind                            binding.kind (BindingKind, same strings as Babel)
 *   binding.path                            binding.declaration (VariableDeclaration,
 *                                           FunctionDeclaration, Parameter, ImportSpecifier, ...)
 *   binding.scope                           binding.scope
 *   path.isReferencedIdentifier()           isReferencedIdentifier(identifierNode), which also
 *                                           returns true for assignment targets
 *   env.parentFunction.scope                env.scopes.getScope(env.parentFunction)
 *   node.loc                                getSourceLocation(node) from ./hir.ts
 *
 * Lowering a function:
 *
 *   const scopes = new ScopeManager(sourceFile);
 *   const contextIdentifiers = findContextIdentifiers(componentNode, scopes);
 *   const env = new Environment(scopes, "Component", validateEnvironmentConfig({}),
 *     contextIdentifiers, componentNode, sourceFile, checker);
 *   const builder = new HIRBuilder(env);
 *   // for an Identifier node `node` in the function body:
 *   const binding = builder.resolveIdentifier(node);       // VariableBinding
 *   if (binding.kind === "Identifier") { place.identifier = binding.identifier; }
 *   const isContext = builder.isContextIdentifier(node);
 *   // for a declaration, `builder.resolveBinding(binding.identifier)` returns the HIR Identifier
 *
 * The HIRBuilder `bindings` map and `context` map are keyed by declaring TS7 Identifier nodes,
 * exactly as Babel's were keyed by `t.Identifier` nodes. Babel's `scope.rename` is not ported:
 * shadowed names are renamed only in the HIR (`x_0`), never in the source.
 */

import type { Node } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import {
  CompilerError,
  type CompilerDiagnostic,
  CompilerErrorDetail,
  ErrorCategory,
} from "../compiler-error.js";
import type { Environment } from "./environment.js";
import {
  type BasicBlock,
  type BlockId,
  type BlockKind,
  GeneratedSource,
  GotoVariant,
  type HIR,
  type Identifier,
  type IdentifierId,
  type Instruction,
  type Place,
  type SourceLocation,
  type Terminal,
  type VariableBinding,
  getSourceLocation,
  makeBlockId,
  makeDeclarationId,
  makeIdentifierName,
  makeInstructionId,
  makeTemporaryIdentifier,
  makeType,
} from "./hir.js";
import type { IdentifierNode } from "./scope.js";
import { eachTerminalSuccessor, terminalFallthrough } from "./visitors.js";

/*
 * *******************************************************************************************
 * *******************************************************************************************
 * ************************************* Lowering to HIR *************************************
 * *******************************************************************************************
 * *******************************************************************************************
 */

// A work-in-progress block that does not yet have a terminator
export interface WipBlock {
  id: BlockId;
  instructions: Array<Instruction>;
  kind: BlockKind;
}

type Scope = LoopScope | LabelScope | SwitchScope;

interface LoopScope {
  kind: "loop";
  label: string | null;
  continueBlock: BlockId;
  breakBlock: BlockId;
}

interface SwitchScope {
  kind: "switch";
  breakBlock: BlockId;
  label: string | null;
}

interface LabelScope {
  kind: "label";
  label: string;
  breakBlock: BlockId;
}

const newBlock = (id: BlockId, kind: BlockKind): WipBlock => ({ id, kind, instructions: [] });

export type Bindings = Map<string, { node: IdentifierNode; identifier: Identifier }>;

/*
 * Determines how instructions should be constructed in order to preserve
 * exception semantics
 */
export type ExceptionsMode =
  /*
   * Mode used for code not covered by explicit exception handling, any
   * errors are assumed to be thrown out of the function
   */
  | { kind: "ThrowExceptions" }
  /*
   * Mode used for code that *is* covered by explicit exception handling
   * (ie try/catch), which requires modeling the possibility of control
   * flow to the exception handler.
   */
  | { kind: "CatchExceptions"; handler: BlockId };

const getImportSource = (node: Node): string => {
  let current: Node | undefined = node;
  while (current !== undefined && !t.isImportDeclaration(current)) {
    current = current.parent;
  }
  return current !== undefined && t.isStringLiteral(current.moduleSpecifier)
    ? current.moduleSpecifier.text
    : "";
};

// Helper class for constructing a CFG
export class HIRBuilder {
  #completed: Map<BlockId, BasicBlock> = new Map();
  #current: WipBlock;
  #entry: BlockId;
  #scopes: Array<Scope> = [];
  #context: Map<IdentifierNode, SourceLocation>;
  #bindings: Bindings;
  #env: Environment;
  #exceptionHandlerStack: Array<BlockId> = [];
  /**
   * Traversal context: counts the number of `fbt` tag parents
   * of the current babel node.
   */
  fbtDepth: number = 0;

  get nextIdentifierId(): IdentifierId {
    return this.#env.nextIdentifierId;
  }

  get context(): Map<IdentifierNode, SourceLocation> {
    return this.#context;
  }

  get bindings(): Bindings {
    return this.#bindings;
  }

  get environment(): Environment {
    return this.#env;
  }

  constructor(
    env: Environment,
    options?: {
      bindings?: Bindings | null;
      context?: Map<IdentifierNode, SourceLocation>;
      entryBlockKind?: BlockKind;
    },
  ) {
    this.#env = env;
    this.#bindings = options?.bindings ?? new Map();
    this.#context = options?.context ?? new Map();
    this.#entry = makeBlockId(env.nextBlockId);
    this.#current = newBlock(this.#entry, options?.entryBlockKind ?? "block");
  }

  recordError(error: CompilerDiagnostic | CompilerErrorDetail): void {
    this.#env.recordError(error);
  }

  currentBlockKind(): BlockKind {
    return this.#current.kind;
  }

  // Push a statement or expression onto the current block
  push(instruction: Instruction): void {
    this.#current.instructions.push(instruction);
    const exceptionHandler = this.#exceptionHandlerStack.at(-1);
    if (exceptionHandler !== undefined) {
      const continuationBlock = this.reserve(this.currentBlockKind());
      this.terminateWithContinuation(
        {
          kind: "maybe-throw",
          continuation: continuationBlock.id,
          handler: exceptionHandler,
          id: makeInstructionId(0),
          loc: instruction.loc,
        },
        continuationBlock,
      );
    }
  }

  enterTryCatch(handler: BlockId, callback: () => void): void {
    this.#exceptionHandlerStack.push(handler);
    callback();
    this.#exceptionHandlerStack.pop();
  }

  resolveThrowHandler(): BlockId | null {
    const handler = this.#exceptionHandlerStack.at(-1);
    return handler ?? null;
  }

  makeTemporary(loc: SourceLocation): Identifier {
    return makeTemporaryIdentifier(this.nextIdentifierId, loc);
  }

  #isModuleBinding(node: IdentifierNode): boolean {
    const scopes = this.#env.scopes;
    const binding = scopes.resolveIdentifier(node);
    const outerBinding = scopes.getBinding(
      scopes.getScope(this.#env.parentFunction).parent,
      node.text,
    );
    return binding !== null && binding === outerBinding;
  }

  /*
   * Maps an Identifier (or JSX identifier) Babel node to an internal `Identifier`
   * which represents the variable being referenced, according to the JS scoping rules.
   *
   * Because Forget does not preserve _all_ block scopes in the input (only those that
   * happen to occur from control flow), this resolution ensures that different variables
   * with the same name are mapped to a unique name. Concretely, this function maintains
   * the invariant that all references to a given variable will return an `Identifier`
   * with the same (unique for the function) `name` and `id`.
   *
   * Example:
   *
   * ```javascript
   * function foo() {
   *    const x = 0;
   *    {
   *      const x = 1;
   *    }
   *    return x;
   * }
   * ```
   *
   * The above converts as follows:
   *
   * ```
   * Const Identifier { name: 'x', id: 0 } = Primitive { value: 0 };
   * Const Identifier { name: 'x_0', id: 1 } = Primitive { value: 1 };
   * Return Identifier { name: 'x', id: 0};
   * ```
   */
  resolveIdentifier(node: IdentifierNode): VariableBinding {
    const originalName = node.text;
    const binding = this.#env.scopes.resolveIdentifier(node);
    if (binding === null) {
      return { kind: "Global", name: originalName };
    }

    // Check if the binding is from module scope
    if (this.#isModuleBinding(node)) {
      const declaration = binding.declaration;
      if (t.isImportClause(declaration)) {
        return {
          kind: "ImportDefault",
          name: originalName,
          module: getImportSource(declaration),
        };
      }
      if (t.isImportSpecifier(declaration)) {
        return {
          kind: "ImportSpecifier",
          name: originalName,
          module: getImportSource(declaration),
          imported: (declaration.propertyName ?? declaration.name).text,
        };
      }
      if (t.isNamespaceImport(declaration)) {
        return {
          kind: "ImportNamespace",
          name: originalName,
          module: getImportSource(declaration),
        };
      }
      return {
        kind: "ModuleLocal",
        name: originalName,
      };
    }

    const resolvedBinding = this.resolveBinding(binding.identifier);
    return {
      kind: "Identifier",
      identifier: resolvedBinding,
      bindingKind: binding.kind,
    };
  }

  isContextIdentifier(node: IdentifierNode): boolean {
    const binding = this.#env.scopes.resolveIdentifier(node);
    if (binding === null || this.#isModuleBinding(node)) {
      // Check if the binding is from module scope, if so return null
      return false;
    }
    return this.#env.isContextIdentifier(binding.identifier);
  }

  resolveBinding(node: IdentifierNode): Identifier {
    if (node.text === "fbt") {
      this.recordError(
        new CompilerErrorDetail({
          category: ErrorCategory.Todo,
          reason: "Support local variables named `fbt`",
          description:
            "Local variables named `fbt` may conflict with the fbt plugin and are not yet supported",
          loc: getSourceLocation(node),
          suggestions: null,
        }),
      );
    }
    const originalName = node.text;
    let name = originalName;
    let index = 0;
    while (true) {
      const mapping = this.#bindings.get(name);
      if (mapping === undefined) {
        const identifierId = this.nextIdentifierId;
        const identifier: Identifier = {
          id: identifierId,
          declarationId: makeDeclarationId(identifierId),
          name: makeIdentifierName(name),
          type: makeType(),
          loc: getSourceLocation(node),
        };
        this.#bindings.set(name, { node, identifier });
        return identifier;
      }
      if (mapping.node === node) {
        return mapping.identifier;
      }
      name = `${originalName}_${index++}`;
    }
  }

  // Construct a final CFG from this context
  build(): HIR {
    const hir: HIR = {
      blocks: this.#completed,
      entry: this.#entry,
    };
    const rpoBlocks = getReversePostorderedBlocks(hir);
    for (const [blockId, block] of hir.blocks) {
      if (
        !rpoBlocks.has(blockId) &&
        block.instructions.some((instr) => instr.value.kind === "FunctionExpression")
      ) {
        this.recordError(
          new CompilerErrorDetail({
            reason: `Support functions with unreachable code that may contain hoisted declarations`,
            loc: block.instructions[0]?.loc ?? block.terminal.loc,
            description: null,
            suggestions: null,
            category: ErrorCategory.Todo,
          }),
        );
      }
    }
    hir.blocks = rpoBlocks;

    removeUnreachableForUpdates(hir);
    removeDeadDoWhileStatements(hir);
    removeUnnecessaryTryCatch(hir);
    markInstructionIds(hir);
    markPredecessors(hir);

    return hir;
  }

  // Terminate the current block w the given terminal, and start a new block
  terminate(terminal: Terminal, nextBlockKind: BlockKind | null): BlockId {
    const blockId = this.#current.id;
    this.#completed.set(blockId, {
      kind: this.#current.kind,
      id: blockId,
      instructions: this.#current.instructions,
      terminal,
      preds: new Set(),
      phis: new Set(),
    });
    if (nextBlockKind) {
      const nextId = this.#env.nextBlockId;
      this.#current = newBlock(nextId, nextBlockKind);
    }
    return blockId;
  }

  /*
   * Terminate the current block w the given terminal, and set the previously
   * reserved block as the new current block
   */
  terminateWithContinuation(terminal: Terminal, continuation: WipBlock): void {
    const blockId = this.#current.id;
    this.#completed.set(blockId, {
      kind: this.#current.kind,
      id: blockId,
      instructions: this.#current.instructions,
      terminal: terminal,
      preds: new Set(),
      phis: new Set(),
    });
    this.#current = continuation;
  }

  /*
   * Reserve a block so that it can be referenced prior to construction.
   * Make this the current block with `terminateWithContinuation()` or
   * call `complete()` to save it without setting it as the current block.
   */
  reserve(kind: BlockKind): WipBlock {
    return newBlock(makeBlockId(this.#env.nextBlockId), kind);
  }

  // Save a previously reserved block as completed
  complete(block: WipBlock, terminal: Terminal): void {
    this.#completed.set(block.id, {
      kind: block.kind,
      id: block.id,
      instructions: block.instructions,
      terminal,
      preds: new Set(),
      phis: new Set(),
    });
  }

  /*
   * Sets the given wip block as the current block, executes the provided callback to populate the block
   * up to its terminal, and then resets the previous actively block.
   */
  enterReserved(wip: WipBlock, callback: () => Terminal): void {
    const current = this.#current;
    this.#current = wip;
    const terminal = callback();
    const blockId = this.#current.id;
    this.#completed.set(blockId, {
      kind: this.#current.kind,
      id: blockId,
      instructions: this.#current.instructions,
      terminal,
      preds: new Set(),
      phis: new Set(),
    });
    this.#current = current;
  }

  /*
   * Create a new block and execute the provided callback with the new block
   * set as the current, resetting to the previously active block upon exit.
   * The lambda must return a terminal node, which is used to terminate the
   * newly constructed block.
   */
  enter(nextBlockKind: BlockKind, callback: (blockId: BlockId) => Terminal): BlockId {
    const wip = this.reserve(nextBlockKind);
    this.enterReserved(wip, () => callback(wip.id));
    return wip.id;
  }

  label<T>(label: string, breakBlock: BlockId, callback: () => T): T {
    this.#scopes.push({
      kind: "label",
      breakBlock,
      label,
    });
    const value = callback();
    const last = this.#scopes.pop();
    CompilerError.invariant(
      last !== undefined &&
        last.kind === "label" &&
        last.label === label &&
        last.breakBlock === breakBlock,
      {
        reason: "Mismatched label",
        loc: GeneratedSource,
      },
    );
    return value;
  }

  switch<T>(label: string | null, breakBlock: BlockId, callback: () => T): T {
    this.#scopes.push({
      kind: "switch",
      breakBlock,
      label,
    });
    const value = callback();
    const last = this.#scopes.pop();
    CompilerError.invariant(
      last !== undefined &&
        last.kind === "switch" &&
        last.label === label &&
        last.breakBlock === breakBlock,
      {
        reason: "Mismatched label",
        loc: GeneratedSource,
      },
    );
    return value;
  }

  /*
   * Executes the provided lambda inside a scope in which the provided loop
   * information is cached for lookup with `lookupBreak()` and `lookupContinue()`
   */
  loop<T>(
    label: string | null,
    // block of the loop body. "continue" jumps here.
    continueBlock: BlockId,
    // block following the loop. "break" jumps here.
    breakBlock: BlockId,
    callback: () => T,
  ): T {
    this.#scopes.push({
      kind: "loop",
      label,
      continueBlock,
      breakBlock,
    });
    const value = callback();
    const last = this.#scopes.pop();
    CompilerError.invariant(
      last !== undefined &&
        last.kind === "loop" &&
        last.label === label &&
        last.continueBlock === continueBlock &&
        last.breakBlock === breakBlock,
      {
        reason: "Mismatched loops",
        loc: GeneratedSource,
      },
    );
    return value;
  }

  /*
   * Lookup the block target for a break statement, based on loops and switch statements
   * in scope. Throws if there is no available location to break.
   */
  lookupBreak(label: string | null): BlockId {
    for (const scope of this.#scopes.toReversed()) {
      if (
        (label === null && (scope.kind === "loop" || scope.kind === "switch")) ||
        label === scope.label
      ) {
        return scope.breakBlock;
      }
    }
    CompilerError.invariant(false, {
      reason: "Expected a loop or switch to be in scope",
      loc: GeneratedSource,
    });
  }

  /*
   * Lookup the block target for a continue statement, based on loops
   * in scope. Throws if there is no available location to continue, or if the given
   * label does not correspond to a loop (this should also be validated at parse time).
   */
  lookupContinue(label: string | null): BlockId {
    for (const scope of this.#scopes.toReversed()) {
      if (scope.kind === "loop") {
        if (label === null || label === scope.label) {
          return scope.continueBlock;
        }
      } else if (label !== null && scope.label === label) {
        CompilerError.invariant(false, {
          reason: "Continue may only refer to a labeled loop",
          loc: GeneratedSource,
        });
      }
    }
    CompilerError.invariant(false, {
      reason: "Expected a loop to be in scope",
      loc: GeneratedSource,
    });
  }
}

export const removeUnreachableForUpdates = (func: HIR): void => {
  for (const [, block] of func.blocks) {
    if (
      block.terminal.kind === "for" &&
      block.terminal.update !== null &&
      !func.blocks.has(block.terminal.update)
    ) {
      block.terminal.update = null;
    }
  }
};

export const removeDeadDoWhileStatements = (func: HIR): void => {
  const visited: Set<BlockId> = new Set();
  for (const [, block] of func.blocks) {
    visited.add(block.id);
  }

  /*
   * If the test condition of a DoWhile is unreachable, the terminal is effectively deadcode and we
   * can just inline the loop body. We replace the terminal with a goto to the loop block and
   * MergeConsecutiveBlocks figures out how to merge as appropriate.
   */
  for (const [, block] of func.blocks) {
    if (block.terminal.kind === "do-while") {
      if (!visited.has(block.terminal.test)) {
        block.terminal = {
          kind: "goto",
          block: block.terminal.loop,
          variant: GotoVariant.Break,
          id: block.terminal.id,
          loc: block.terminal.loc,
        };
      }
    }
  }
};

/*
 * Converts the graph to reverse-postorder, with predecessor blocks appearing
 * before successors except in the case of back edges (ie loops).
 */
export const reversePostorderBlocks = (func: HIR): void => {
  const rpoBlocks = getReversePostorderedBlocks(func);
  func.blocks = rpoBlocks;
};

/**
 * Returns a mapping of BlockId => BasicBlock where the insertion order of the map
 * has blocks in reverse-postorder, with predecessor blocks appearing before successors
 * except in the case of back edges (ie loops). Note that not all blocks in the input
 * may be in the output: blocks will be removed in the case of unreachable code in
 * the input.
 */
const getReversePostorderedBlocks = (func: HIR): HIR["blocks"] => {
  const visited: Set<BlockId> = new Set();
  const used: Set<BlockId> = new Set();
  const usedFallthroughs: Set<BlockId> = new Set();
  const postorder: Array<BlockId> = [];
  const visit = (blockId: BlockId, isUsed: boolean): void => {
    const wasUsed = used.has(blockId);
    const wasVisited = visited.has(blockId);
    visited.add(blockId);
    if (isUsed) {
      used.add(blockId);
    }
    if (wasVisited && (wasUsed || !isUsed)) {
      return;
    }

    /*
     * Note that we visit successors in reverse order. This ensures that when we
     * reverse the list at the end, that "sibling" edges appear in-order. For example,
     * ```
     * // bb0
     * let x;
     * if (c) {
     *    // bb1
     *    x = 1;
     * } else {
     *    // bb2
     *    x = 2;
     * }
     * // bb3
     * x;
     * ```
     *
     * We want the output to be bb0, bb1, bb2, bb3 just to line up with the original
     * program order for visual debugging. By visiting the successors in reverse order
     * (eg bb2 then bb1), we ensure that they get reversed back to the correct order.
     */
    const block = func.blocks.get(blockId);
    CompilerError.invariant(block !== undefined, {
      reason: "[HIRBuilder] Unexpected null block",
      description: `expected block ${blockId} to exist`,
      loc: GeneratedSource,
    });
    const successors = eachTerminalSuccessor(block.terminal).reverse();
    const fallthrough = terminalFallthrough(block.terminal);

    /**
     * Fallthrough blocks are only used to record original program block structure. If the
     * fallthrough is actually reachable, it will be reached through terminal successors.
     * To retain program structure, we visit fallthrough blocks first (marking them as not
     * actually used yet) to ensure their block IDs emitted in the correct order.
     */
    if (fallthrough !== null) {
      if (isUsed) {
        usedFallthroughs.add(fallthrough);
      }
      visit(fallthrough, false);
    }
    for (const successor of successors) {
      visit(successor, isUsed);
    }

    if (!wasVisited) {
      postorder.push(blockId);
    }
  };
  visit(func.entry, true);
  const blocks = new Map<BlockId, BasicBlock>();
  for (const blockId of postorder.reverse()) {
    const block = func.blocks.get(blockId);
    if (block === undefined) {
      continue;
    }
    if (used.has(blockId)) {
      blocks.set(blockId, block);
    } else if (usedFallthroughs.has(blockId)) {
      blocks.set(blockId, {
        ...block,
        instructions: [],
        terminal: {
          kind: "unreachable",
          id: block.terminal.id,
          loc: block.terminal.loc,
        },
      });
    }
    // otherwise this block is unreachable
  }

  return blocks;
};

export const markInstructionIds = (func: HIR): void => {
  let nextId = 0;
  const visited = new Set<Instruction>();
  for (const [, block] of func.blocks) {
    for (const instr of block.instructions) {
      CompilerError.invariant(!visited.has(instr), {
        reason: `Instruction [${instr.id}] already visited!`,
        loc: instr.loc,
      });
      visited.add(instr);
      instr.id = makeInstructionId(++nextId);
    }
    block.terminal.id = makeInstructionId(++nextId);
  }
};

export const markPredecessors = (func: HIR): void => {
  for (const [, block] of func.blocks) {
    block.preds.clear();
  }
  const visited: Set<BlockId> = new Set();
  const visit = (blockId: BlockId, prevBlock: BasicBlock | null): void => {
    const block = func.blocks.get(blockId);
    if (block === undefined) {
      return;
    }
    if (prevBlock) {
      block.preds.add(prevBlock.id);
    }

    if (visited.has(blockId)) {
      return;
    }
    visited.add(blockId);

    for (const successor of eachTerminalSuccessor(block.terminal)) {
      visit(successor, block);
    }
  };
  visit(func.entry, null);
};

/*
 * Finds try terminals where the handler is unreachable, and converts the try
 * to a goto(terminal.block)
 */
export const removeUnnecessaryTryCatch = (func: HIR): void => {
  for (const [, block] of func.blocks) {
    if (block.terminal.kind === "try" && !func.blocks.has(block.terminal.handler)) {
      const handlerId = block.terminal.handler;
      const fallthroughId = block.terminal.fallthrough;
      const fallthrough = func.blocks.get(fallthroughId);
      block.terminal = {
        kind: "goto",
        block: block.terminal.block,
        id: makeInstructionId(0),
        loc: block.terminal.loc,
        variant: GotoVariant.Break,
      };

      if (fallthrough !== undefined) {
        if (fallthrough.preds.size === 1 && fallthrough.preds.has(handlerId)) {
          // delete fallthrough
          func.blocks.delete(fallthroughId);
        } else {
          fallthrough.preds.delete(handlerId);
        }
      }
    }
  }
};

export const createTemporaryPlace = (env: Environment, loc: SourceLocation): Place => ({
  kind: "Identifier",
  identifier: makeTemporaryIdentifier(env.nextIdentifierId, loc),
  loc: GeneratedSource,
});

/**
 * Clones an existing Place, returning a new temporary Place that shares the
 * same metadata properties as the original place (effect, reactive flag, type)
 * but has a new, temporary Identifier.
 */
export const clonePlaceToTemporary = (env: Environment, place: Place): Place => {
  const temp = createTemporaryPlace(env, place.loc);
  temp.identifier.type = place.identifier.type;
  return temp;
};
