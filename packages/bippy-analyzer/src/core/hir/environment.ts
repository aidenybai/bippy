/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/Environment.ts at b618bbb.

import { CompilerError, type CompilerErrorDetail, ErrorCategory } from "../compiler-error.js";
import { type BlockId, type IdentifierId, makeBlockId, makeIdentifierId } from "./hir.js";
import type { FunctionNode, IdentifierNode, ScopeManager } from "./scope.js";

export type ReactFunctionType = "Component" | "Hook" | "Other";

export class Environment {
  #nextIdentifer: number = 0;
  #nextBlock: number = 0;
  scopes: ScopeManager;
  fnType: ReactFunctionType;

  #contextIdentifiers: Set<IdentifierNode>;
  #hoistedIdentifiers: Set<IdentifierNode> = new Set();
  parentFunction: FunctionNode;

  /**
   * Accumulated compilation errors. Passes record errors here instead of
   * throwing, so the pipeline can continue and report all errors at once.
   */
  #errors: CompilerError = new CompilerError();

  constructor(
    scopes: ScopeManager,
    fnType: ReactFunctionType,
    contextIdentifiers: Set<IdentifierNode>,
    parentFunction: FunctionNode, // the outermost function being compiled
  ) {
    this.scopes = scopes;
    this.fnType = fnType;
    this.parentFunction = parentFunction;
    this.#contextIdentifiers = contextIdentifiers;
  }

  get nextIdentifierId(): IdentifierId {
    return makeIdentifierId(this.#nextIdentifer++);
  }

  get nextBlockId(): BlockId {
    return makeBlockId(this.#nextBlock++);
  }

  /**
   * Record a single error detail on this environment.
   * If the error is an Invariant, it is immediately thrown since invariants
   * represent internal bugs that cannot be recovered from.
   * Otherwise, the error is accumulated.
   */
  recordError(error: CompilerErrorDetail): void {
    if (error.category === ErrorCategory.Invariant) {
      const compilerError = new CompilerError();
      compilerError.details.push(error);
      throw compilerError;
    }
    this.#errors.details.push(error);
  }

  /**
   * Returns true if any errors have been recorded during compilation.
   */
  hasErrors(): boolean {
    return this.#errors.details.length > 0;
  }

  /**
   * Returns the accumulated CompilerError containing all recorded errors.
   */
  aggregateErrors(): CompilerError {
    return this.#errors;
  }

  isContextIdentifier(node: IdentifierNode): boolean {
    return this.#contextIdentifiers.has(node);
  }

  isHoistedIdentifier(node: IdentifierNode): boolean {
    return this.#hoistedIdentifiers.has(node);
  }

  addHoistedIdentifier(node: IdentifierNode): void {
    this.#contextIdentifiers.add(node);
    this.#hoistedIdentifiers.add(node);
  }
}
