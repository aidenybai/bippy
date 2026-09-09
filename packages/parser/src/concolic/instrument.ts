import type { Program, Span } from "oxc-parser";
import { parseSync } from "oxc-parser";
import { InstrumentationError } from "../errors.js";
import type { SourceLanguage } from "../types.js";
import { HOOK_GLOBAL_NAME, INSTRUMENTED_FUNCTION_MARK } from "./hooks.js";

// Instrumentation is a textual rewrite driven by the oxc AST: hook calls are
// inserted around the source spans of the expressions they wrap, so the
// TypeScript/JSX source stays valid and is handed to esbuild afterwards for
// type stripping and JSX compilation. Every hook call site is numbered and its
// original `file:line:column` recorded, so decisions replay by location.

export interface InstrumentedSource {
  code: string;
  /** Leading string directives (`"use client"`, `"use server"`). */
  directives: string[];
  /** Operations left uninstrumented because the source text between their operands was not the expected punctuation. */
  skipped: number;
}

/** Hook call sites shared by every module of one exploration, so decision keys are stable across paths. */
export class SiteTable {
  readonly locations: string[] = [];

  add(location: string): number {
    this.locations.push(location);
    return this.locations.length - 1;
  }
}

const BINARY_HOOKS: Record<string, string> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "%": "mod",
  "**": "exp",
  "<<": "shl",
  ">>": "shr",
  ">>>": "ushr",
  "&": "band",
  "|": "bor",
  "^": "bxor",
  "==": "eq",
  "!=": "ne",
  "===": "seq",
  "!==": "sne",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
  in: "in",
  instanceof: "instanceof",
};

const UNARY_HOOKS: Record<string, string> = {
  "!": "not",
  "-": "neg",
  "+": "pos",
  "~": "bnot",
  typeof: "typeof",
};

const SKIPPED_KEYS = new Set([
  "type",
  "start",
  "end",
  "typeAnnotation",
  "typeParameters",
  "typeArguments",
  "returnType",
  "superTypeArguments",
  "implements",
  "decorators",
]);

const TS_EXPRESSION_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

const CALL_OPEN = /^\s*(?:\?\.)?\s*\(\s*$/;
const MEMBER_DOT = /^\s*(?:\?\.|\.)\s*$/;
const MEMBER_OPEN_BRACKET = /^\s*(?:\?\.)?\s*\[\s*$/;
const MEMBER_CLOSE_BRACKET_CALL_OPEN = /^\s*\]\s*(?:\?\.)?\s*\(\s*$/;
const CALL_CLOSE = /^\s*,?\s*\)\s*$/;
const EMPTY_CALL = /^\s*(?:\?\.)?\s*\(\s*\)\s*$/;
const BRACKET_EMPTY_CALL = /^\s*\]\s*(?:\?\.)?\s*\(\s*\)\s*$/;
const ARGUMENT_SEPARATOR = /^\s*,\s*$/;
const NEW_KEYWORD = /^\s*new\s+$/;
const OPTIONAL_EMPTY_CALL = /^\s*(?:\(\s*\))?\s*$/;
const DIRECTIVE_OR_MARK = /^\s*(?:"use strict"|'use strict')/;

interface Edit {
  offset: number;
  /** Text removed from `offset` on; zero for a pure insertion. */
  length: number;
  text: string;
  rank: number;
  sequence: number;
}

/** Ordering at one offset: closes of inner spans, then opens of outer spans, then a replacement starting there. */
const CLOSE_RANK = 0;
const OPEN_RANK = 1;
const REPLACE_RANK = 2;

class SourceEdits {
  private readonly edits: Edit[] = [];
  private sequence = 0;

  constructor(private readonly source: string) {}

  open(offset: number, text: string): void {
    this.edits.push({ offset, length: 0, text, rank: OPEN_RANK, sequence: this.sequence++ });
  }

  close(offset: number, text: string): void {
    this.edits.push({ offset, length: 0, text, rank: CLOSE_RANK, sequence: this.sequence++ });
  }

  replace(start: number, end: number, text: string): void {
    this.edits.push({
      offset: start,
      length: end - start,
      text,
      rank: REPLACE_RANK,
      sequence: this.sequence++,
    });
  }

  between(start: number, end: number): string {
    return this.source.slice(start, end);
  }

  apply(): string {
    const ordered = [...this.edits].sort((left, right) => {
      if (left.offset !== right.offset) return left.offset - right.offset;
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.rank === CLOSE_RANK
        ? right.sequence - left.sequence
        : left.sequence - right.sequence;
    });
    let output = "";
    let cursor = 0;
    for (const edit of ordered) {
      if (edit.offset < cursor) continue;
      output += this.source.slice(cursor, edit.offset) + edit.text;
      cursor = edit.offset + edit.length;
    }
    return output + this.source.slice(cursor);
  }
}

const findLineIndex = (lineStarts: number[], offset: number): number => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
};

const buildLineStarts = (sourceText: string): number[] => {
  const lineStarts = [0];
  let newlineIndex = sourceText.indexOf("\n");
  while (newlineIndex !== -1) {
    lineStarts.push(newlineIndex + 1);
    newlineIndex = sourceText.indexOf("\n", newlineIndex + 1);
  }
  return lineStarts;
};

interface VisitContext {
  /** The node is written to (assignment/update target, `delete` operand), so its read must not be hooked. */
  isTarget: boolean;
  /** Inside an optional chain: member reads stay as written and calls take the lenient optional hooks. */
  isChain: boolean;
}

const ROOT_CONTEXT: VisitContext = { isTarget: false, isChain: false };
const TARGET_CONTEXT: VisitContext = { isTarget: true, isChain: false };
const CHAIN_CONTEXT: VisitContext = { isTarget: false, isChain: true };

class Instrumenter {
  private readonly edits: SourceEdits;
  private readonly lineStarts: number[];
  private readonly hook = HOOK_GLOBAL_NAME;
  skipped = 0;

  constructor(
    source: string,
    private readonly displayPath: string,
    private readonly sites: SiteTable,
  ) {
    this.edits = new SourceEdits(source);
    this.lineStarts = buildLineStarts(source);
  }

  run(program: Program): string {
    this.visitChildren(program, ROOT_CONTEXT);
    return this.edits.apply();
  }

  private site(span: Span): number {
    const lineIndex = findLineIndex(this.lineStarts, span.start);
    const column = span.start - this.lineStarts[lineIndex] + 1;
    return this.sites.add(`${this.displayPath}:${lineIndex + 1}:${column}`);
  }

  private matches(start: number, end: number, expected: RegExp): boolean {
    if (expected.test(this.edits.between(start, end))) return true;
    this.skipped++;
    return false;
  }

  private visitChildren(node: object, context: VisitContext): void {
    for (const [key, value] of Object.entries(node)) {
      if (SKIPPED_KEYS.has(key)) continue;
      if (Array.isArray(value)) {
        for (const element of value) this.visitUnknown(element, context);
      } else {
        this.visitUnknown(value, context);
      }
    }
  }

  private visitUnknown(value: unknown, context: VisitContext): void {
    if (isNode(value)) this.visit(value, context);
  }

  private visitAll(nodes: unknown[], context: VisitContext): void {
    for (const node of nodes) this.visitUnknown(node, context);
  }

  private visit(untyped: Record<string, unknown> & { type: string }, context: VisitContext): void {
    if (untyped.type.startsWith("TS") && !TS_EXPRESSION_WRAPPERS.has(untyped.type)) return;
    const node: object = untyped;
    if (untyped.type.startsWith("JSX")) {
      this.visitChildren(node, ROOT_CONTEXT);
      return;
    }
    switch (untyped.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        this.markFunction(untyped);
        this.visitChildren(node, ROOT_CONTEXT);
        return;
      case "BinaryExpression":
        this.visitBinary(untyped);
        return;
      case "LogicalExpression":
        this.visitLogical(untyped);
        return;
      case "UnaryExpression":
        this.visitUnary(untyped);
        return;
      case "ConditionalExpression":
      case "IfStatement":
        this.wrapCondition(untyped.test, "C");
        this.visitChildren(node, ROOT_CONTEXT);
        return;
      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement":
        if (untyped.test) this.wrapCondition(untyped.test, "CL");
        this.visitChildren(node, ROOT_CONTEXT);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        this.wrapUnaryHook(untyped.right, untyped.type === "ForInStatement" ? "K" : "S", true);
        this.visitUnknown(untyped.left, TARGET_CONTEXT);
        this.visitUnknown(untyped.right, ROOT_CONTEXT);
        this.visitUnknown(untyped.body, ROOT_CONTEXT);
        return;
      case "SwitchStatement":
        this.visitSwitch(untyped);
        return;
      case "MemberExpression":
        this.visitMember(untyped, context);
        return;
      case "CallExpression":
        this.visitCall(untyped, context);
        return;
      case "NewExpression":
        this.visitNew(untyped);
        return;
      case "TemplateLiteral":
        this.visitTemplate(untyped);
        return;
      case "ChainExpression":
        this.visitUnknown(untyped.expression, CHAIN_CONTEXT);
        return;
      case "ArrayExpression":
        if (Array.isArray(untyped.elements)) this.visitSpreadable(untyped.elements, "S");
        return;
      case "ObjectExpression":
        if (Array.isArray(untyped.properties)) this.visitSpreadable(untyped.properties, "SO");
        return;
      case "AssignmentExpression":
        this.visitUnknown(untyped.left, TARGET_CONTEXT);
        this.visitUnknown(untyped.right, ROOT_CONTEXT);
        return;
      case "UpdateExpression":
        this.visitUnknown(untyped.argument, TARGET_CONTEXT);
        return;
      case "ArrayPattern":
      case "ObjectPattern":
      case "AssignmentPattern":
      case "RestElement":
        this.visitChildren(node, TARGET_CONTEXT);
        return;
      case "Property":
        this.visitUnknown(untyped.key, untyped.computed ? ROOT_CONTEXT : TARGET_CONTEXT);
        this.visitUnknown(untyped.value, context);
        return;
      default:
        this.visitChildren(node, ROOT_CONTEXT);
    }
  }

  private markFunction(node: Record<string, unknown>): void {
    const body = node.body;
    if (!isSpan(body)) return;
    if (isNode(body) && body.type === "BlockStatement") {
      const opening = this.edits.between(body.start, body.start + 1);
      if (opening !== "{") return;
      const rest = this.edits.between(body.start + 1, body.end);
      this.edits.open(
        body.start + 1,
        DIRECTIVE_OR_MARK.test(rest) ? "" : ` ${INSTRUMENTED_FUNCTION_MARK}`,
      );
      return;
    }
    this.edits.open(body.start, `${INSTRUMENTED_FUNCTION_MARK} `);
  }

  private visitBinary(node: Record<string, unknown>): void {
    const { left, right, operator } = node;
    const hook = typeof operator === "string" ? BINARY_HOOKS[operator] : undefined;
    if (
      hook &&
      isSpan(left) &&
      isSpan(right) &&
      isNode(left) &&
      left.type !== "PrivateIdentifier"
    ) {
      const expected = new RegExp(`^\\s*${escapeRegExp(String(operator))}\\s*$`);
      if (this.matches(left.end, right.start, expected)) {
        this.edits.open(left.start, `${this.hook}.${hook}(`);
        this.edits.replace(left.end, right.start, ", ");
        this.edits.close(right.end, ")");
      }
    }
    this.visitUnknown(left, ROOT_CONTEXT);
    this.visitUnknown(right, ROOT_CONTEXT);
  }

  private visitLogical(node: Record<string, unknown>): void {
    const { left, right, operator } = node;
    if (isSpan(left) && isSpan(right)) {
      const expected = new RegExp(`^\\s*${escapeRegExp(String(operator))}\\s*$`);
      if (this.matches(left.end, right.start, expected)) {
        const site = this.site(left);
        const decide = operator === "??" ? "Q" : "C";
        const onTrue = operator === "&&" || operator === "??";
        this.edits.open(left.start, `(${this.hook}.${decide}(${this.hook}.k = `);
        this.edits.replace(
          left.end,
          right.start,
          `, ${site}) ? ${onTrue ? "" : `${this.hook}.k : `}`,
        );
        this.edits.close(right.end, `${onTrue ? ` : ${this.hook}.k` : ""})`);
      }
    }
    this.visitUnknown(left, ROOT_CONTEXT);
    this.visitUnknown(right, ROOT_CONTEXT);
  }

  private visitUnary(node: Record<string, unknown>): void {
    const { argument, operator } = node;
    const hook = typeof operator === "string" ? UNARY_HOOKS[operator] : undefined;
    if (operator === "delete") {
      this.visitUnknown(argument, TARGET_CONTEXT);
      return;
    }
    if (hook && isSpan(argument) && isSpan(node) && isNode(argument)) {
      if (operator === "typeof" && argument.type === "Identifier") {
        const name = this.edits.between(argument.start, argument.end);
        this.edits.replace(
          node.start,
          node.end,
          `${this.hook}.typeof(typeof ${name} === "undefined" ? void 0 : ${name})`,
        );
        return;
      }
      const expected = new RegExp(`^\\s*${escapeRegExp(String(operator))}\\s*$`);
      if (this.matches(node.start, argument.start, expected)) {
        this.edits.replace(node.start, argument.start, `${this.hook}.${hook}(`);
        this.edits.close(argument.end, ")");
      }
    }
    this.visitUnknown(argument, ROOT_CONTEXT);
  }

  private wrapCondition(test: unknown, hook: "C" | "CL"): void {
    if (!isSpan(test)) return;
    this.edits.open(test.start, `${this.hook}.${hook}(`);
    this.edits.close(test.end, `, ${this.site(test)})`);
  }

  private wrapUnaryHook(target: unknown, hook: string, withSite: boolean): void {
    if (!isSpan(target)) return;
    this.edits.open(target.start, `${this.hook}.${hook}(`);
    this.edits.close(target.end, withSite ? `, ${this.site(target)})` : ")");
  }

  private visitSwitch(node: Record<string, unknown>): void {
    const { discriminant, cases } = node;
    if (isSpan(discriminant) && Array.isArray(cases)) {
      const site = this.site(discriminant);
      const tests = cases.flatMap((switchCase: unknown) =>
        isNode(switchCase) && isSpan(switchCase.test) ? [switchCase.test] : [],
      );
      this.edits.open(discriminant.start, `${this.hook}.SW(`);
      this.edits.close(discriminant.end, `, ${site}, ${tests.length})`);
      tests.forEach((test, index) => {
        this.edits.open(test.start, `${this.hook}.SK(${index}, `);
        this.edits.close(test.end, `, ${site})`);
      });
    }
    this.visitChildren(node, ROOT_CONTEXT);
  }

  private visitMember(node: Record<string, unknown>, context: VisitContext): void {
    const { object, property, computed } = node;
    this.visitUnknown(object, context.isChain ? CHAIN_CONTEXT : ROOT_CONTEXT);
    if (computed === true) this.visitUnknown(property, ROOT_CONTEXT);
    if (
      computed !== true ||
      context.isTarget ||
      context.isChain ||
      !isSpan(node) ||
      !isSpan(object) ||
      !isSpan(property) ||
      !isNode(object) ||
      object.type === "Super" ||
      (isNode(property) && property.type === "Literal")
    ) {
      return;
    }
    if (!this.matches(object.end, property.start, MEMBER_OPEN_BRACKET)) return;
    this.edits.open(object.start, `${this.hook}.G(`);
    this.edits.replace(object.end, property.start, ", ");
    this.edits.replace(property.end, node.end, ")");
  }

  private visitCall(node: Record<string, unknown>, context: VisitContext): void {
    const { callee, arguments: args } = node;
    if (!isSpan(node) || !isSpan(callee) || !isNode(callee) || !Array.isArray(args)) {
      this.visitChildren(node, ROOT_CONTEXT);
      return;
    }
    const argumentSpans: Span[] = args.filter(isSpan);
    if (
      callee.type === "Super" ||
      callee.type === "Import" ||
      argumentSpans.length !== args.length ||
      !this.hasCleanArgumentList(argumentSpans, node.end)
    ) {
      this.visitChildren(node, ROOT_CONTEXT);
      return;
    }
    const isOptional = context.isChain;
    const hasSpread = args.some(
      (argument: unknown) => isNode(argument) && argument.type === "SpreadElement",
    );
    const usesArray = isOptional || hasSpread || args.length > 3;
    const site = this.site(node);
    const isMethod =
      callee.type === "MemberExpression" &&
      isNode(callee) &&
      isSpan(callee.object) &&
      isNode(callee.object) &&
      callee.object.type !== "Super" &&
      isSpan(callee.property);
    if (isMethod && isNode(callee) && isSpan(callee.object) && isSpan(callee.property)) {
      const receiver = callee.object;
      const property = callee.property;
      const isComputed = callee.computed === true;
      const hookName = isOptional ? "MO" : usesArray ? "Mn" : `M${args.length}`;
      const firstArgument = argumentSpans[0];
      const lastArgument = argumentSpans[argumentSpans.length - 1];
      const closeText = `${usesArray ? "]" : ""}, ${site})`;
      if (isComputed) {
        if (
          !this.matches(receiver.end, property.start, MEMBER_OPEN_BRACKET) ||
          !this.matches(
            property.end,
            firstArgument?.start ?? node.end,
            firstArgument ? MEMBER_CLOSE_BRACKET_CALL_OPEN : BRACKET_EMPTY_CALL,
          )
        ) {
          this.visitChildren(node, ROOT_CONTEXT);
          return;
        }
        this.edits.open(receiver.start, `${this.hook}.${hookName}(`);
        this.edits.replace(receiver.end, property.start, ", ");
        if (firstArgument && lastArgument) {
          this.edits.replace(property.end, firstArgument.start, `, ${usesArray ? "[" : ""}`);
          this.edits.replace(lastArgument.end, node.end, closeText);
        } else {
          this.edits.replace(property.end, node.end, `, ${usesArray ? "[], " : ""}${site})`);
        }
      } else {
        if (
          !this.matches(receiver.end, property.start, MEMBER_DOT) ||
          !this.matches(
            property.end,
            firstArgument?.start ?? node.end,
            firstArgument ? CALL_OPEN : EMPTY_CALL,
          )
        ) {
          this.visitChildren(node, ROOT_CONTEXT);
          return;
        }
        const propertyName = JSON.stringify(this.edits.between(property.start, property.end));
        this.edits.open(receiver.start, `${this.hook}.${hookName}(`);
        if (firstArgument && lastArgument) {
          this.edits.replace(
            receiver.end,
            firstArgument.start,
            `, ${propertyName}, ${usesArray ? "[" : ""}`,
          );
          this.edits.replace(lastArgument.end, node.end, closeText);
        } else {
          this.edits.replace(
            receiver.end,
            node.end,
            `, ${propertyName}, ${usesArray ? "[], " : ""}${site})`,
          );
        }
      }
      this.visitUnknown(receiver, isOptional ? CHAIN_CONTEXT : ROOT_CONTEXT);
      if (isComputed) this.visitUnknown(property, ROOT_CONTEXT);
      this.visitSpreadable(args, "S");
      return;
    }
    const hookName = isOptional ? "FO" : usesArray ? "Fn" : `F${args.length}`;
    const firstArgument = argumentSpans[0];
    const lastArgument = argumentSpans[argumentSpans.length - 1];
    if (
      !this.matches(
        callee.end,
        firstArgument?.start ?? node.end,
        firstArgument ? CALL_OPEN : EMPTY_CALL,
      )
    ) {
      this.visitChildren(node, ROOT_CONTEXT);
      return;
    }
    this.edits.open(callee.start, `${this.hook}.${hookName}(`);
    if (firstArgument && lastArgument) {
      this.edits.replace(callee.end, firstArgument.start, `, ${usesArray ? "[" : ""}`);
      this.edits.replace(lastArgument.end, node.end, `${usesArray ? "]" : ""}, ${site})`);
    } else {
      this.edits.replace(callee.end, node.end, `, ${usesArray ? "[], " : ""}${site})`);
    }
    this.visitUnknown(callee, isOptional ? CHAIN_CONTEXT : ROOT_CONTEXT);
    this.visitSpreadable(args, "S");
  }

  private hasCleanArgumentList(argumentSpans: Span[], callEnd: number): boolean {
    for (let index = 1; index < argumentSpans.length; index++) {
      if (
        !this.matches(argumentSpans[index - 1].end, argumentSpans[index].start, ARGUMENT_SEPARATOR)
      ) {
        return false;
      }
    }
    const last = argumentSpans[argumentSpans.length - 1];
    return last === undefined || this.matches(last.end, callEnd, CALL_CLOSE);
  }

  private visitNew(node: Record<string, unknown>): void {
    const { callee, arguments: args } = node;
    if (!isSpan(node) || !isSpan(callee) || !Array.isArray(args)) {
      this.visitChildren(node, ROOT_CONTEXT);
      return;
    }
    const argumentSpans: Span[] = args.filter(isSpan);
    const firstArgument = argumentSpans[0];
    const lastArgument = argumentSpans[argumentSpans.length - 1];
    const isClean =
      argumentSpans.length === args.length &&
      this.matches(node.start, callee.start, NEW_KEYWORD) &&
      this.hasCleanArgumentList(argumentSpans, node.end) &&
      (firstArgument
        ? this.matches(callee.end, firstArgument.start, CALL_OPEN)
        : this.matches(callee.end, node.end, OPTIONAL_EMPTY_CALL));
    if (!isClean) {
      this.visitChildren(node, ROOT_CONTEXT);
      return;
    }
    const site = this.site(node);
    this.edits.replace(node.start, callee.start, `${this.hook}.NEW(`);
    if (firstArgument && lastArgument) {
      this.edits.replace(callee.end, firstArgument.start, ", [");
      this.edits.replace(lastArgument.end, node.end, `], ${site})`);
    } else {
      this.edits.replace(callee.end, node.end, `, [], ${site})`);
    }
    this.visitUnknown(callee, ROOT_CONTEXT);
    this.visitSpreadable(args, "S");
  }

  private visitTemplate(node: Record<string, unknown>): void {
    const { quasis, expressions } = node;
    if (!isSpan(node) || !Array.isArray(quasis) || !Array.isArray(expressions)) return;
    const expressionSpans: Span[] = expressions.filter(isSpan);
    const cooked = quasis.map((quasi: unknown) =>
      isNode(quasi) && isRecord(quasi.value) && typeof quasi.value.cooked === "string"
        ? quasi.value.cooked
        : null,
    );
    if (
      expressionSpans.length > 0 &&
      expressionSpans.length === expressions.length &&
      cooked.length === expressions.length + 1 &&
      cooked.every((text) => text !== null)
    ) {
      const literal = (index: number): string => JSON.stringify(cooked[index] ?? "");
      this.edits.replace(node.start, expressionSpans[0].start, `${this.hook}.T(${literal(0)}, `);
      for (let index = 1; index < expressionSpans.length; index++) {
        this.edits.replace(
          expressionSpans[index - 1].end,
          expressionSpans[index].start,
          `, ${literal(index)}, `,
        );
      }
      const last = expressionSpans[expressionSpans.length - 1];
      this.edits.replace(last.end, node.end, `, ${literal(expressionSpans.length)})`);
    }
    this.visitAll(expressions, ROOT_CONTEXT);
  }

  private visitSpreadable(elements: unknown[], hook: "S" | "SO"): void {
    for (const element of elements) {
      if (isNode(element) && element.type === "SpreadElement" && isSpan(element.argument)) {
        this.wrapUnaryHook(element.argument, hook, true);
        this.visitUnknown(element.argument, ROOT_CONTEXT);
      } else {
        this.visitUnknown(element, ROOT_CONTEXT);
      }
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSpan = (value: unknown): value is Span & Record<string, unknown> =>
  isRecord(value) && typeof value.start === "number" && typeof value.end === "number";

const isNode = (value: unknown): value is Record<string, unknown> & { type: string } =>
  isRecord(value) && typeof value.type === "string";

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getParserLanguage = (lang: SourceLanguage): "js" | "jsx" | "ts" | "tsx" =>
  lang === "js" || lang === "json" ? "jsx" : lang;

export interface InstrumentOptions {
  filePath: string;
  displayPath: string;
  sourceText: string;
  lang: SourceLanguage;
  sites: SiteTable;
}

export const instrumentSource = ({
  filePath,
  displayPath,
  sourceText,
  lang,
  sites,
}: InstrumentOptions): InstrumentedSource => {
  const parsed = parseSync(filePath, sourceText, {
    lang: getParserLanguage(lang),
    sourceType: "module",
    preserveParens: true,
  });
  const fatal = parsed.errors.find((error) => error.severity === "Error");
  if (fatal) throw new InstrumentationError(filePath, fatal.message);
  const instrumenter = new Instrumenter(sourceText, displayPath, sites);
  const directives = parsed.program.body.flatMap((statement) =>
    "directive" in statement && typeof statement.directive === "string"
      ? [statement.directive]
      : [],
  );
  return { code: instrumenter.run(parsed.program), directives, skipped: instrumenter.skipped };
};
