/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/CompilerError.ts at b618bbb.

import type { SourceLocation } from "./hir/hir.js";
import { Err, Ok, type Result } from "./utils/result.js";
import { assertExhaustive } from "./utils/utils.js";

export enum ErrorSeverity {
  /**
   * An actionable error that the developer can fix. For example, product code errors should be
   * reported as such.
   */
  Error = "Error",
  /**
   * An error that the developer may not necessarily be able to fix. For example, syntax not
   * supported by the compiler does not indicate any fault in the product code.
   */
  Warning = "Warning",
  /**
   * Not an error. These will not be surfaced in ESLint, but may be surfaced in other ways
   * (eg Forgive) where informational hints can be shown.
   */
  Hint = "Hint",
  /**
   * These errors will not be reported anywhere. Useful for work in progress validations.
   */
  Off = "Off",
}

export interface CompilerDiagnosticOptions {
  category: ErrorCategory;
  reason: string;
  description: string | null;
  details: Array<CompilerDiagnosticDetail>;
  suggestions?: Array<CompilerSuggestion> | null | undefined;
}

export type CompilerDiagnosticDetail =
  /**
   * A/the source of the error
   */
  | {
      kind: "error";
      loc: SourceLocation | null;
      message: string | null;
    }
  | {
      kind: "hint";
      message: string;
    };

export enum CompilerSuggestionOperation {
  InsertBefore,
  InsertAfter,
  Remove,
  Replace,
}
export type CompilerSuggestion =
  | {
      op:
        | CompilerSuggestionOperation.InsertAfter
        | CompilerSuggestionOperation.InsertBefore
        | CompilerSuggestionOperation.Replace;
      range: [number, number];
      description: string;
      text: string;
    }
  | {
      op: CompilerSuggestionOperation.Remove;
      range: [number, number];
      description: string;
    };

/**
 * @deprecated use {@link CompilerDiagnosticOptions} instead
 */
export interface CompilerErrorDetailOptions {
  category: ErrorCategory;
  reason: string;
  description?: string | null | undefined;
  loc: SourceLocation | null;
  suggestions?: Array<CompilerSuggestion> | null | undefined;
}

export interface PrintErrorMessageOptions {
  /**
   * ESLint uses 1-indexed columns and prints one error at a time
   * So it doesn't require the "Found # error(s)" text
   */
  eslint: boolean;
}

export class CompilerDiagnostic {
  options: CompilerDiagnosticOptions;

  constructor(options: CompilerDiagnosticOptions) {
    this.options = options;
  }

  static create(options: Omit<CompilerDiagnosticOptions, "details">): CompilerDiagnostic {
    return new CompilerDiagnostic({ ...options, details: [] });
  }

  get reason(): CompilerDiagnosticOptions["reason"] {
    return this.options.reason;
  }
  get description(): CompilerDiagnosticOptions["description"] {
    return this.options.description;
  }
  get severity(): ErrorSeverity {
    return getRuleForCategory(this.category).severity;
  }
  get suggestions(): CompilerDiagnosticOptions["suggestions"] {
    return this.options.suggestions;
  }
  get category(): ErrorCategory {
    return this.options.category;
  }

  withDetails(...details: Array<CompilerDiagnosticDetail>): CompilerDiagnostic {
    this.options.details.push(...details);
    return this;
  }

  primaryLocation(): SourceLocation | null {
    const firstErrorDetail = this.options.details.filter((detail) => detail.kind === "error")[0];
    return firstErrorDetail !== undefined && firstErrorDetail.kind === "error"
      ? firstErrorDetail.loc
      : null;
  }

  printErrorMessage(options: PrintErrorMessageOptions): string {
    const buffer = [printErrorSummary(this.category, this.reason)];
    if (this.description !== null) {
      buffer.push("\n\n", `${this.description}.`);
    }
    for (const detail of this.options.details) {
      switch (detail.kind) {
        case "error": {
          const loc = detail.loc;
          if (loc === null || typeof loc === "symbol") {
            continue;
          }
          buffer.push("\n\n");
          const column = options.eslint ? loc.column + 1 : loc.column;
          buffer.push(`${loc.filename}:${loc.line}:${column}\n`);
          buffer.push(detail.message ?? "");
          break;
        }
        case "hint": {
          buffer.push("\n\n");
          buffer.push(detail.message);
          break;
        }
        default: {
          assertExhaustive(detail, "Unexpected detail kind");
        }
      }
    }
    return buffer.join("");
  }

  toString(): string {
    const buffer = [printErrorSummary(this.category, this.reason)];
    if (this.description !== null) {
      buffer.push(`. ${this.description}.`);
    }
    const loc = this.primaryLocation();
    if (loc !== null && typeof loc !== "symbol") {
      buffer.push(` (${loc.line}:${loc.column})`);
    }
    return buffer.join("");
  }
}

/**
 * Each bailout or invariant in HIR lowering creates an {@link CompilerErrorDetail}, which is then
 * aggregated into a single {@link CompilerError} later.
 *
 * @deprecated use {@link CompilerDiagnostic} instead
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
  get severity(): ErrorSeverity {
    return getRuleForCategory(this.category).severity;
  }
  get loc(): CompilerErrorDetailOptions["loc"] {
    return this.options.loc;
  }
  get suggestions(): CompilerErrorDetailOptions["suggestions"] {
    return this.options.suggestions;
  }
  get category(): ErrorCategory {
    return this.options.category;
  }

  primaryLocation(): SourceLocation | null {
    return this.loc;
  }

  printErrorMessage(options: PrintErrorMessageOptions): string {
    const buffer = [printErrorSummary(this.category, this.reason)];
    if (this.description !== undefined && this.description !== null) {
      buffer.push(`\n\n${this.description}.`);
    }
    const loc = this.loc;
    if (loc !== null && typeof loc !== "symbol") {
      buffer.push(`\n\n`);
      const column = options.eslint ? loc.column + 1 : loc.column;
      buffer.push(`${loc.filename}:${loc.line}:${column}\n`);
      buffer.push("\n\n");
    }
    return buffer.join("");
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
 * An aggregate of {@link CompilerDiagnostic}. This allows us to aggregate all issues found by the
 * compiler into a single error before we throw. Where possible, prefer to push diagnostics into
 * the error aggregate instead of throwing immediately.
 */
export class CompilerError extends Error {
  details: Array<CompilerErrorDetail | CompilerDiagnostic> = [];
  disabledDetails: Array<CompilerErrorDetail | CompilerDiagnostic> = [];
  printedMessage: string | null = null;

  static invariant(
    condition: unknown,
    options: {
      reason: CompilerDiagnosticOptions["reason"];
      description?: CompilerDiagnosticOptions["description"];
      message?: string | null;
      loc: SourceLocation;
    },
  ): asserts condition {
    if (!condition) {
      const errors = new CompilerError();
      errors.pushDiagnostic(
        CompilerDiagnostic.create({
          reason: options.reason,
          description: options.description ?? null,
          category: ErrorCategory.Invariant,
        }).withDetails({
          kind: "error",
          loc: options.loc,
          message: options.message ?? options.reason,
        }),
      );
      throw errors;
    }
  }

  static throwDiagnostic(options: CompilerDiagnosticOptions): never {
    const errors = new CompilerError();
    errors.pushDiagnostic(new CompilerDiagnostic(options));
    throw errors;
  }

  static throwTodo(options: Omit<CompilerErrorDetailOptions, "category">): never {
    const errors = new CompilerError();
    errors.pushErrorDetail(
      new CompilerErrorDetail({
        ...options,
        category: ErrorCategory.Todo,
      }),
    );
    throw errors;
  }

  static throwInvalidJS(options: Omit<CompilerErrorDetailOptions, "category">): never {
    const errors = new CompilerError();
    errors.pushErrorDetail(
      new CompilerErrorDetail({
        ...options,
        category: ErrorCategory.Syntax,
      }),
    );
    throw errors;
  }

  static throwInvalidReact(options: CompilerErrorDetailOptions): never {
    const errors = new CompilerError();
    errors.pushErrorDetail(new CompilerErrorDetail(options));
    throw errors;
  }

  static throwInvalidConfig(options: Omit<CompilerErrorDetailOptions, "category">): never {
    const errors = new CompilerError();
    errors.pushErrorDetail(
      new CompilerErrorDetail({
        ...options,
        category: ErrorCategory.Config,
      }),
    );
    throw errors;
  }

  static throw(options: CompilerErrorDetailOptions): never {
    const errors = new CompilerError();
    errors.pushErrorDetail(new CompilerErrorDetail(options));
    throw errors;
  }

  constructor(...args: ConstructorParameters<typeof Error>) {
    super(...args);
    this.name = "ReactCompilerError";
    this.details = [];
    this.disabledDetails = [];
  }

  override get message(): string {
    return this.printedMessage ?? this.toString();
  }

  override set message(_message: string) {}

  override toString(): string {
    if (this.printedMessage) {
      return this.printedMessage;
    }
    if (Array.isArray(this.details)) {
      return this.details.map((detail) => detail.toString()).join("\n\n");
    }
    return this.name;
  }

  withPrintedMessage(options: PrintErrorMessageOptions): CompilerError {
    this.printedMessage = this.printErrorMessage(options);
    return this;
  }

  printErrorMessage(options: PrintErrorMessageOptions): string {
    const onlyDetail = this.details[0];
    if (options.eslint && this.details.length === 1 && onlyDetail !== undefined) {
      return onlyDetail.printErrorMessage(options);
    }
    return (
      `Found ${this.details.length} error${this.details.length === 1 ? "" : "s"}:\n\n` +
      this.details.map((detail) => detail.printErrorMessage(options).trim()).join("\n\n")
    );
  }

  merge(other: CompilerError): void {
    this.details.push(...other.details);
    this.disabledDetails.push(...other.disabledDetails);
  }

  pushDiagnostic(diagnostic: CompilerDiagnostic): void {
    if (diagnostic.severity === ErrorSeverity.Off) {
      this.disabledDetails.push(diagnostic);
    } else {
      this.details.push(diagnostic);
    }
  }

  /**
   * @deprecated use {@link pushDiagnostic} instead
   */
  push(options: CompilerErrorDetailOptions): CompilerErrorDetail {
    const detail = new CompilerErrorDetail({
      category: options.category,
      reason: options.reason,
      description: options.description ?? null,
      suggestions: options.suggestions,
      loc: typeof options.loc === "symbol" ? null : options.loc,
    });
    return this.pushErrorDetail(detail);
  }

  /**
   * @deprecated use {@link pushDiagnostic} instead
   */
  pushErrorDetail(detail: CompilerErrorDetail): CompilerErrorDetail {
    if (detail.severity === ErrorSeverity.Off) {
      this.disabledDetails.push(detail);
    } else {
      this.details.push(detail);
    }
    return detail;
  }

  hasAnyErrors(): boolean {
    return this.details.length > 0;
  }

  asResult(): Result<void, CompilerError> {
    return this.hasAnyErrors() ? Err(this) : Ok(undefined);
  }

  /**
   * Returns true if any of the error details are of severity Error.
   */
  hasErrors(): boolean {
    return this.details.some((detail) => detail.severity === ErrorSeverity.Error);
  }

  /**
   * Returns true if there are no Errors and there is at least one Warning.
   */
  hasWarning(): boolean {
    if (this.hasErrors()) {
      return false;
    }
    return this.details.some((detail) => detail.severity === ErrorSeverity.Warning);
  }

  hasHints(): boolean {
    if (
      this.details.some(
        (detail) =>
          detail.severity === ErrorSeverity.Error || detail.severity === ErrorSeverity.Warning,
      )
    ) {
      return false;
    }
    return this.details.some((detail) => detail.severity === ErrorSeverity.Hint);
  }
}

const printErrorSummary = (category: ErrorCategory, message: string): string => {
  let heading: string;
  switch (category) {
    case ErrorCategory.CapitalizedCalls:
    case ErrorCategory.Config:
    case ErrorCategory.EffectDerivationsOfState:
    case ErrorCategory.EffectSetState:
    case ErrorCategory.ErrorBoundaries:
    case ErrorCategory.FBT:
    case ErrorCategory.Gating:
    case ErrorCategory.Globals:
    case ErrorCategory.Hooks:
    case ErrorCategory.Immutability:
    case ErrorCategory.Purity:
    case ErrorCategory.Refs:
    case ErrorCategory.RenderSetState:
    case ErrorCategory.StaticComponents:
    case ErrorCategory.Suppression:
    case ErrorCategory.Syntax:
    case ErrorCategory.UseMemo:
    case ErrorCategory.VoidUseMemo:
    case ErrorCategory.MemoDependencies:
    case ErrorCategory.EffectExhaustiveDependencies: {
      heading = "Error";
      break;
    }
    case ErrorCategory.EffectDependencies:
    case ErrorCategory.IncompatibleLibrary:
    case ErrorCategory.PreserveManualMemo:
    case ErrorCategory.UnsupportedSyntax: {
      heading = "Compilation Skipped";
      break;
    }
    case ErrorCategory.Invariant: {
      heading = "Invariant";
      break;
    }
    case ErrorCategory.Todo: {
      heading = "Todo";
      break;
    }
    default: {
      assertExhaustive(category, `Unhandled category '${category}'`);
    }
  }
  return `${heading}: ${message}`;
};

/**
 * See getRuleForCategory() for how these map to ESLint rules
 */
export enum ErrorCategory {
  /**
   * Checking for valid hooks usage (non conditional, non-first class, non reactive, etc)
   */
  Hooks = "Hooks",
  /**
   * Checking for no capitalized calls (not definitively an error, hence separating)
   */
  CapitalizedCalls = "CapitalizedCalls",
  /**
   * Checking for static components
   */
  StaticComponents = "StaticComponents",
  /**
   * Checking for valid usage of manual memoization
   */
  UseMemo = "UseMemo",
  /**
   * Checking that useMemos always return a value
   */
  VoidUseMemo = "VoidUseMemo",
  /**
   * Checks that manual memoization is preserved
   */
  PreserveManualMemo = "PreserveManualMemo",
  /**
   * Checks for exhaustive useMemo/useCallback dependencies without extraneous values
   */
  MemoDependencies = "MemoDependencies",
  /**
   * Checks for known incompatible libraries
   */
  IncompatibleLibrary = "IncompatibleLibrary",
  /**
   * Checking for no mutations of props, hook arguments, hook return values
   */
  Immutability = "Immutability",
  /**
   * Checking for assignments to globals
   */
  Globals = "Globals",
  /**
   * Checking for valid usage of refs, ie no access during render
   */
  Refs = "Refs",
  /**
   * Checks for memoized effect deps
   */
  EffectDependencies = "EffectDependencies",
  /**
   * Checks for exhaustive and extraneous effect dependencies
   */
  EffectExhaustiveDependencies = "EffectExhaustiveDependencies",
  /**
   * Checks for no setState in effect bodies
   */
  EffectSetState = "EffectSetState",
  EffectDerivationsOfState = "EffectDerivationsOfState",
  /**
   * Validates against try/catch in place of error boundaries
   */
  ErrorBoundaries = "ErrorBoundaries",
  /**
   * Checking for pure functions
   */
  Purity = "Purity",
  /**
   * Validates against setState in render
   */
  RenderSetState = "RenderSetState",
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
  /**
   * Config errors
   */
  Config = "Config",
  /**
   * Gating error
   */
  Gating = "Gating",
  /**
   * Suppressions
   */
  Suppression = "Suppression",
  /**
   * fbt-specific issues
   */
  FBT = "FBT",
}

export enum LintRulePreset {
  /**
   * Rules that are stable and included in the `recommended` preset.
   */
  Recommended = "recommended",
  /**
   * Rules that are more experimental and only included in the `recommended-latest` preset.
   */
  RecommendedLatest = "recommended-latest",
  /**
   * Rules that are disabled.
   */
  Off = "off",
}

export interface LintRule {
  // Stores the category the rule corresponds to, used to filter errors when reporting
  category: ErrorCategory;

  // Stores the severity of the error, which is used to map to lint levels such as error/warning.
  severity: ErrorSeverity;

  /**
   * The "name" of the rule as it will be used by developers to enable/disable, eg
   * "eslint-disable-nest line <name>"
   */
  name: string;

  /**
   * A description of the rule that appears somewhere in ESLint. This does not affect
   * how error messages are formatted
   */
  description: string;

  /**
   * Configures the preset in which the rule is enabled. If 'off', the rule will not be included in
   * any preset.
   *
   * NOTE: not all validations are enabled by default! Setting this flag only affects
   * whether a given rule is part of the recommended set. The corresponding validation
   * also should be enabled by default if you want the error to actually show up!
   */
  preset: LintRulePreset;
}

export const getRuleForCategory = (category: ErrorCategory): LintRule => {
  switch (category) {
    case ErrorCategory.CapitalizedCalls: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "capitalized-calls",
        description: "Validates against calling capitalized functions/methods instead of using JSX",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.Config: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "config",
        description: "Validates the compiler configuration options",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.EffectDependencies: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "memoized-effect-dependencies",
        description: "Validates that effect dependencies are memoized",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.EffectExhaustiveDependencies: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "exhaustive-effect-dependencies",
        description:
          "Validates that effect dependencies are exhaustive and without extraneous values",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.EffectDerivationsOfState: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "no-deriving-state-in-effects",
        description: "Validates against deriving values from state in an effect",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.EffectSetState: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "set-state-in-effect",
        description:
          "Validates against calling setState synchronously in an effect. " +
          "This can indicate non-local derived data, a derived event pattern, or " +
          "improper external data synchronization.",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.ErrorBoundaries: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "error-boundaries",
        description:
          "Validates usage of error boundaries instead of try/catch for errors in child components",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.FBT: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "fbt",
        description: "Validates usage of fbt",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.Gating: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "gating",
        description:
          "Validates configuration of [gating mode](https://react.dev/reference/react-compiler/gating)",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.Globals: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "globals",
        description:
          "Validates against assignment/mutation of globals during render, part of ensuring that " +
          "[side effects must render outside of render](https://react.dev/reference/rules/components-and-hooks-must-be-pure#side-effects-must-run-outside-of-render)",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.Hooks: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "hooks",
        description: "Validates the rules of hooks",
        /**
         * TODO: the "Hooks" rule largely reimplements the "rules-of-hooks" non-compiler rule.
         * We need to dedeupe these (moving the remaining bits into the compiler) and then enable
         * this rule.
         */
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.Immutability: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "immutability",
        description:
          "Validates against mutating props, state, and other values that [are immutable](https://react.dev/reference/rules/components-and-hooks-must-be-pure#props-and-state-are-immutable)",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.Invariant: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "invariant",
        description: "Internal invariants",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.PreserveManualMemo: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "preserve-manual-memoization",
        description:
          "Validates that existing manual memoized is preserved by the compiler. " +
          "React Compiler will only compile components and hooks if its inference " +
          "[matches or exceeds the existing manual memoization](https://react.dev/learn/react-compiler/introduction#what-should-i-do-about-usememo-usecallback-and-reactmemo)",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.Purity: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "purity",
        description:
          "Validates that [components/hooks are pure](https://react.dev/reference/rules/components-and-hooks-must-be-pure) by checking that they do not call known-impure functions",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.Refs: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "refs",
        description:
          'Validates correct usage of refs, not reading/writing during render. See the "pitfalls" section in [`useRef()` usage](https://react.dev/reference/react/useRef#usage)',
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.RenderSetState: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "set-state-in-render",
        description:
          "Validates against setting state during render, which can trigger additional renders and potential infinite render loops",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.StaticComponents: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "static-components",
        description:
          "Validates that components are static, not recreated every render. Components that are recreated dynamically can reset state and trigger excessive re-rendering",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.Suppression: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "rule-suppression",
        description: "Validates against suppression of other rules",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.Syntax: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "syntax",
        description: "Validates against invalid syntax",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.Todo: {
      return {
        category,
        severity: ErrorSeverity.Hint,
        name: "todo",
        description: "Unimplemented features",
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.UnsupportedSyntax: {
      return {
        category,
        severity: ErrorSeverity.Warning,
        name: "unsupported-syntax",
        description: "Validates against syntax that we do not plan to support in React Compiler",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.UseMemo: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "use-memo",
        description:
          "Validates usage of the useMemo() hook against common mistakes. See [`useMemo()` docs](https://react.dev/reference/react/useMemo) for more information.",
        preset: LintRulePreset.Recommended,
      };
    }
    case ErrorCategory.VoidUseMemo: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "void-use-memo",
        description:
          "Validates that useMemos always return a value and that the result of the useMemo is used by the component/hook. See [`useMemo()` docs](https://react.dev/reference/react/useMemo) for more information.",
        preset: LintRulePreset.RecommendedLatest,
      };
    }
    case ErrorCategory.MemoDependencies: {
      return {
        category,
        severity: ErrorSeverity.Error,
        name: "memo-dependencies",
        description:
          "Validates that useMemo() and useCallback() specify comprehensive dependencies without extraneous values. See [`useMemo()` docs](https://react.dev/reference/react/useMemo) for more information.",
        /**
         * TODO: the "MemoDependencies" rule largely reimplements the "exhaustive-deps" non-compiler rule,
         * allowing the compiler to ensure it does not regress change behavior due to different dependencies.
         * We previously relied on the source having ESLint suppressions for any exhaustive-deps violations,
         * but it's more reliable to verify it within the compiler.
         *
         * Long-term we should de-duplicate these implementations.
         */
        preset: LintRulePreset.Off,
      };
    }
    case ErrorCategory.IncompatibleLibrary: {
      return {
        category,
        severity: ErrorSeverity.Warning,
        name: "incompatible-library",
        description:
          "Validates against usage of libraries which are incompatible with memoization (manual or automatic)",
        preset: LintRulePreset.Recommended,
      };
    }
    default: {
      assertExhaustive(category, `Unsupported category ${category}`);
    }
  }
};
