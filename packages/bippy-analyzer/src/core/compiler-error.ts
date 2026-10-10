/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/CompilerError.ts at b618bbb.

import type { SourceLocation } from "./hir/hir.js";
import { assertExhaustive } from "./utils/utils.js";

export enum ErrorCategory {
  /**
   * Internal invariants
   */
  Invariant = "Invariant",
  /**
   * Todos
   */
  Todo = "Todo",
  /**
   * Syntax errors
   */
  Syntax = "Syntax",
  /**
   * Checks for use of unsupported syntax
   */
  UnsupportedSyntax = "UnsupportedSyntax",
}

interface CompilerErrorDetailOptions {
  category: ErrorCategory;
  reason: string;
  description?: string | null | undefined;
  loc: SourceLocation | null;
}

/**
 * Each bailout or invariant in HIR lowering creates an {@link CompilerErrorDetail}, which is then
 * aggregated into a single {@link CompilerError} later.
 */
export class CompilerErrorDetail {
  options: CompilerErrorDetailOptions;

  constructor(options: CompilerErrorDetailOptions) {
    this.options = options;
  }

  get reason(): CompilerErrorDetailOptions["reason"] {
    return this.options.reason;
  }
  get description(): CompilerErrorDetailOptions["description"] {
    return this.options.description;
  }
  get loc(): CompilerErrorDetailOptions["loc"] {
    return this.options.loc;
  }
  get category(): ErrorCategory {
    return this.options.category;
  }

  toString(): string {
    const buffer = [printErrorSummary(this.category, this.reason)];
    if (this.description !== undefined && this.description !== null) {
      buffer.push(`. ${this.description}.`);
    }
    const loc = this.loc;
    if (loc !== null && typeof loc !== "symbol") {
      buffer.push(` (${loc.line}:${loc.column})`);
    }
    return buffer.join("");
  }
}

/**
 * An aggregate of {@link CompilerErrorDetail}. This allows us to aggregate all issues found by the
 * compiler into a single error before we throw. Where possible, prefer to push details into
 * the error aggregate instead of throwing immediately.
 */
export class CompilerError extends Error {
  details: Array<CompilerErrorDetail> = [];

  static invariant(
    condition: unknown,
    options: {
      reason: string;
      description?: string | null;
      loc: SourceLocation;
    },
  ): asserts condition {
    if (!condition) {
      throw CompilerError.#fromDetail({ ...options, category: ErrorCategory.Invariant });
    }
  }

  static throwTodo(options: Omit<CompilerErrorDetailOptions, "category">): never {
    throw CompilerError.#fromDetail({ ...options, category: ErrorCategory.Todo });
  }

  static #fromDetail(options: CompilerErrorDetailOptions): CompilerError {
    const errors = new CompilerError();
    errors.details.push(new CompilerErrorDetail(options));
    return errors;
  }

  override name = "ReactCompilerError";

  override get message(): string {
    return this.toString();
  }

  override set message(_message: string) {}

  override toString(): string {
    return this.details.map((detail) => detail.toString()).join("\n\n");
  }
}

const printErrorSummary = (category: ErrorCategory, message: string): string => {
  switch (category) {
    case ErrorCategory.Syntax: {
      return `Error: ${message}`;
    }
    case ErrorCategory.UnsupportedSyntax: {
      return `Compilation Skipped: ${message}`;
    }
    case ErrorCategory.Invariant: {
      return `Invariant: ${message}`;
    }
    case ErrorCategory.Todo: {
      return `Todo: ${message}`;
    }
    default: {
      return assertExhaustive(category, `Unhandled category '${category}'`);
    }
  }
};
