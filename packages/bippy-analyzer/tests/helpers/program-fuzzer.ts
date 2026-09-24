import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { types } from "node:util";
import { constants, createContext, Script } from "node:vm";
import { parseSync, traverse } from "@babel/core";
import {
  Arbitrary,
  Stream,
  Value,
  asyncProperty,
  check,
  pre,
  stream,
  type Parameters,
  type Random,
} from "fast-check";
import { primitiveValue, unknownPrimitiveValue } from "../../src/evaluate/values.js";
import type { SsaFallback } from "../../src/evaluate/ssa-profile.js";
import type { StaticPrimitive } from "../../src/types.js";
import {
  decodePrimitive,
  encodePrimitive,
  evaluateCaseOutcomes,
  getAssignmentGuard,
  getBooleanInputGuards,
  observeCompletion,
  observeNative,
  type CaseEvaluation,
  type FunctionExecution,
  type ObservedCompletion,
  type ObservedValue,
} from "./differential-evaluator.js";

export interface FuzzNode {
  role: "statement" | "clause" | "block" | "expression" | "fixed";
  parts: (string | FuzzNode)[];
}

export interface FuzzProgram {
  grammar: "scalar" | "heap" | "corpus";
  root: FuzzNode;
  /** The real function a corpus program was extracted from. */
  origin?: string;
}

export interface GeneratedFuzzProgram extends FuzzProgram {
  grammar: "scalar" | "heap";
}

export interface FuzzCase {
  program: FuzzProgram;
  input: StaticPrimitive;
}

export interface FuzzAssignment {
  first: boolean;
  second: boolean;
  expected: ObservedCompletion;
  actual: ObservedCompletion[];
}

export interface FuzzResult {
  signature: string | null;
  execution: FunctionExecution | null;
  crash: string | null;
  assignments: FuzzAssignment[];
}

export interface FuzzFailure extends FuzzCase {
  result: FuzzResult;
  seed: number;
  path: string;
}

export interface FuzzCampaign {
  failures: FuzzFailure[];
  /** Signatures of generated (not shrunk) cases, including uncertain ones. */
  observed: Map<string, number>;
}

export interface FuzzCampaignOptions {
  seed: number;
  numRuns: number;
  known?: Set<string>;
}

export interface FuzzRepro {
  /** fast-check replay coordinates; valid while the generators are unchanged. */
  seed?: number;
  path?: string;
  grammar: FuzzProgram["grammar"];
  signature: string;
  mode: string;
  fallback: SsaFallback | null;
  input: string;
  source: string;
  assignments: FuzzAssignment[];
  origin?: string;
  rootCause?: string;
}

export interface GetRandom {
  (limit: number): number;
}

interface GeneratorScope {
  getRandom: GetRandom;
  grammar: GeneratedFuzzProgram["grammar"];
  depth: number;
  isInLoop: boolean;
  isBreakable: boolean;
  labels: string[];
  loopLabels: string[];
  names: string[];
  counter: { next: number };
}

export const FUZZ_REPRO_DIRECTORY = resolve(import.meta.dirname, "../fuzz-repros");

export const FUZZ_INPUTS: StaticPrimitive[] = [
  undefined,
  0,
  1,
  true,
  null,
  "",
  "1",
  "a",
  -1,
  -0,
  NaN,
  Infinity,
  0n,
  2n,
];

const LITERALS = [
  "0",
  "(-0)",
  "1",
  "2",
  "(-1)",
  "NaN",
  "Infinity",
  "1n",
  "0n",
  "(-2n)",
  '""',
  '"1"',
  '"a"',
  "null",
  "undefined",
  "true",
  "false",
];
const EXPONENTS = ["0", "1", "2", "(-1)", "0n", "1n", "2n", '"2"', "undefined"];
const TARGETS = ["alpha", "beta", "total", "flag", "trace"];
const INITIAL_NAMES = [...TARGETS, "value", "first", "second"];
const UNARY_OPERATORS = ["-", "+", "!", "~", "typeof ", "void "];
const BINARY_OPERATORS = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
  "<",
  "<=",
  "==",
  "!=",
  "===",
  "!==",
  "&&",
  "||",
  "??",
];
const ASSIGNMENT_OPERATORS = ["=", "+=", "-=", "*=", "|=", "&&=", "||=", "??="];
const HEAP_READS = [
  "box.count",
  "other.count",
  "alias.count",
  "watched.current",
  "readAlpha()",
  "coerce",
  "primitive",
  "list.length",
  "listAlias[0]",
  "maybe?.count",
];
const HEAP_CALLEES = ["box.add", "other.add", "bump", "(0, box.add)", "box.add.bind(other)"];
const HEAP_OPTIONAL_CALLEES = [
  "maybe?.add",
  "maybe?.add?.",
  "box.missing?.",
  "list.push",
  "setBeta",
];
const HEAP_SLOTS = [
  "completion",
  "value",
  "alpha",
  "beta",
  "total",
  "flag",
  "trace",
  "box.count",
  "other.count",
  "list",
  "events",
];
const HEAP_PRELUDE = `const events = [];
const record = (tag, item) => { events.push(tag, item); return item; };
`;
const HEAP_SETUP = `let total = 0, flag = first, trace = "";
const box = { count: 1, add(step) { this.count += step; return record("add", this.count); } };
const other = { count: 10, add: box.add };
const alias = box;
const bump = (step) => { total += step; return record("bump", total); };
const readAlpha = () => alpha;
const apply = (callback, item) => callback(item);
const coerce = { valueOf() { record("valueOf", alpha); return alpha; }, toString() { record("toString", beta); return "text"; } };
const watched = { get current() { record("get", total); return total; }, set current(next) { record("set", next); total = next; } };
const primitive = { [Symbol.toPrimitive](hint) { record("hint", hint); return hint === "number" ? alpha : "p"; } };
const list = [1, 2];
const listAlias = list;
const maybe = first ? box : null;
const setBeta = (next) => { beta = next; return record("setBeta", next); };
let completion;
try { completion = ["return", (() => {
`;
const HEAP_EPILOGUE = `})()]; } catch (error) { completion = ["throw", error]; }
return [completion[0], completion[1], alpha, beta, total, flag, trace, box.count, other.count, list, events];`;
const ASSIGNMENTS = [false, true].flatMap((first) =>
  [false, true].map((second) => ({ first, second })),
);
const COMPOUND_STATEMENT_BUDGET = 48;
const SYMBOLIC_INPUTS = {
  first: unknownPrimitiveValue("boolean", "first"),
  second: unknownPrimitiveValue("boolean", "second"),
};
const INPUT_GUARDS = getBooleanInputGuards(Object.values(SYMBOLIC_INPUTS));
const FUZZ_MAX_STEPS = 1_000_000;

const node = (role: FuzzNode["role"], ...parts: FuzzNode["parts"]): FuzzNode => ({ role, parts });
const leaf = (text: string): FuzzNode => node("expression", text);
const pick = <Item>(scope: GeneratorScope, items: Item[]): Item =>
  items[scope.getRandom(items.length)];

const createLeaf = (scope: GeneratorScope): FuzzNode => {
  const names = scope.grammar === "heap" ? [...scope.names, ...HEAP_READS] : scope.names;
  return leaf(scope.getRandom(2) ? pick(scope, names) : pick(scope, LITERALS));
};

const createHeapExpression = (scope: GeneratorScope, getNested: () => FuzzNode): FuzzNode => {
  switch (scope.getRandom(9)) {
    case 0:
      return node("expression", `${pick(scope, HEAP_CALLEES)}(`, getNested(), ")");
    case 7:
      return node("expression", `${pick(scope, ["String", "Number"])}(`, getNested(), ")");
    case 1:
      return node("expression", `${pick(scope, HEAP_OPTIONAL_CALLEES)}(`, getNested(), ")");
    case 2:
      return node("expression", "`t${", getNested(), "}|${", getNested(), "}`");
    case 3:
      return node("expression", "(", getNested(), ", ", getNested(), ")");
    case 4:
      return node("expression", "(", getNested(), " in box)");
    case 5:
      return node("expression", `${pick(scope, ["box", "list", "listAlias"])}[`, getNested(), "]");
    case 6:
      return leaf(pick(scope, ["listAlias.pop()", "list.shift()"]));
    default:
      return node("expression", `record("r${scope.counter.next++}", `, getNested(), ")");
  }
};

const createExpression = (scope: GeneratorScope, depth: number): FuzzNode => {
  if (depth <= 0 || scope.getRandom(3) === 0) return createLeaf(scope);
  const getNested = () => createExpression(scope, depth - 1);
  const choice = scope.getRandom(scope.grammar === "heap" ? 10 : 7);
  if (choice === 0) return node("expression", `(${pick(scope, UNARY_OPERATORS)}`, getNested(), ")");
  if (choice === 1 || choice === 6) {
    const operator = pick(scope, BINARY_OPERATORS);
    const right = operator === "**" ? leaf(pick(scope, EXPONENTS)) : getNested();
    return node("expression", "(", getNested(), ` ${operator} `, right, ")");
  }
  if (choice === 2)
    return node("expression", "(", getNested(), " ? ", getNested(), " : ", getNested(), ")");
  if (choice === 3)
    return node("expression", `(trace += "e${scope.counter.next++}", `, getNested(), ")");
  if (choice === 4) {
    const target = pick(scope, TARGETS);
    return node("expression", `(${target} ${pick(scope, ASSIGNMENT_OPERATORS)} `, getNested(), ")");
  }
  if (choice === 5) {
    const target = pick(scope, TARGETS);
    return leaf(pick(scope, [`(${target}++)`, `(${target}--)`, `(++${target})`, `(--${target})`]));
  }
  return createHeapExpression(scope, getNested);
};

const createStatements = (scope: GeneratorScope, minimum: number, maximum: number): FuzzNode[] =>
  Array.from({ length: minimum + scope.getRandom(maximum - minimum + 1) }, () =>
    createStatement(scope),
  );

const createBlock = (scope: GeneratorScope): FuzzNode =>
  node("block", "{ ", ...createStatements(scope, 1, 3), "}");

const createHeapStatement = (scope: GeneratorScope): FuzzNode => {
  const argument = createExpression(scope, 2);
  switch (scope.getRandom(5)) {
    case 0:
      return node("statement", "alias.count = ", argument, ";");
    case 1:
      return node("statement", "watched.current = ", argument, ";");
    case 2:
      return node("statement", "box.add.call(other, ", argument, ");");
    case 3:
      return node("statement", "apply(bump, ", argument, ");");
    default:
      return node("statement", `${pick(scope, HEAP_CALLEES)}(`, argument, ");");
  }
};

const createTransfer = (scope: GeneratorScope): FuzzNode => {
  const transfers = [
    ...(scope.isBreakable ? ["break;"] : []),
    ...(scope.isInLoop ? ["continue;"] : []),
    ...scope.labels.map((label) => `break ${label};`),
    ...scope.loopLabels.map((label) => `continue ${label};`),
  ];
  const condition = createExpression(scope, 1);
  if (transfers.length && scope.getRandom(2))
    return node("statement", "if (", condition, `) ${pick(scope, transfers)}`);
  const keyword = pick(scope, ["return", "throw"]);
  return node("statement", "if (", condition, `) ${keyword} `, createExpression(scope, 2), ";");
};

const createLoop = (scope: GeneratorScope, identifier: number): FuzzNode => {
  const index = `index${identifier}`;
  const count = scope.getRandom(4);
  const label = scope.getRandom(3) === 0 ? `loop${identifier}` : null;
  const body = createBlock({
    ...scope,
    depth: scope.depth + 1,
    isInLoop: true,
    isBreakable: true,
    labels: label ? [...scope.labels, label] : scope.labels,
    loopLabels: label ? [...scope.loopLabels, label] : scope.loopLabels,
    names: [...scope.names, index],
  });
  const prefix = label ? `${label}: ` : "";
  switch (scope.getRandom(scope.grammar === "heap" ? 5 : 3)) {
    case 0:
      return node(
        "statement",
        `${prefix}for (let ${index} = 0; ${index} < ${count}; ${index}++) `,
        body,
      );
    case 1:
      return node(
        "statement",
        `{ let ${index} = ${count}; ${prefix}while (${index}-- > 0) `,
        body,
        " }",
      );
    case 2:
      return node(
        "statement",
        `{ let ${index} = 0; ${prefix}do `,
        body,
        ` while (++${index} < ${count}); }`,
      );
    case 3:
      return node("statement", `${prefix}for (const ${index} in box) `, body);
    default:
      return node(
        "statement",
        `${prefix}for (const ${index} of [`,
        createLeaf(scope),
        ", ",
        createLeaf(scope),
        "]) ",
        body,
      );
  }
};

const createSwitch = (scope: GeneratorScope): FuzzNode => {
  const inner = { ...scope, depth: scope.depth + 1, isBreakable: true };
  const clauses = Array.from({ length: 1 + scope.getRandom(3) }, () =>
    node(
      "clause",
      "case ",
      leaf(pick(scope, LITERALS)),
      ": ",
      ...createStatements(inner, 0, 2),
      ...(scope.getRandom(2) ? [node("statement", "break;")] : []),
    ),
  );
  clauses.splice(
    scope.getRandom(clauses.length + 1),
    0,
    node("clause", "default: ", ...createStatements(inner, 0, 2)),
  );
  return node("statement", "switch (", createExpression(scope, 1), ") { ", ...clauses, "}");
};

const createTry = (scope: GeneratorScope): FuzzNode => {
  const inner = { ...scope, depth: scope.depth + 1 };
  const protectedBlock = createBlock(inner);
  const handler = () => createBlock({ ...inner, names: [...scope.names, "caught"] });
  switch (scope.getRandom(3)) {
    case 0:
      return node("statement", "try ", protectedBlock, " catch (caught) ", handler());
    case 1:
      return node("statement", "try ", protectedBlock, " finally ", createBlock(inner));
    default:
      return node(
        "statement",
        "try ",
        protectedBlock,
        " catch (caught) ",
        handler(),
        " finally ",
        createBlock(inner),
      );
  }
};

const createShadow = (scope: GeneratorScope): FuzzNode => {
  const inner: GeneratorScope = {
    ...scope,
    depth: scope.depth + 1,
    isInLoop: false,
    isBreakable: false,
    labels: [],
    loopLabels: [],
  };
  return node(
    "statement",
    "trace += ((alpha, beta = alpha) => { ",
    ...createStatements(inner, 1, 3),
    "return beta; })(",
    createExpression(scope, 1),
    ");",
  );
};

const createStatement = (scope: GeneratorScope): FuzzNode => {
  const identifier = scope.counter.next++;
  const inner = { ...scope, depth: scope.depth + 1 };
  const isCompound = scope.depth < 3 && identifier < COMPOUND_STATEMENT_BUDGET;
  const choice = scope.getRandom(isCompound ? (scope.grammar === "heap" ? 15 : 14) : 6);
  switch (choice) {
    case 0:
      return node("statement", createExpression(scope, 3), ";");
    case 1:
      return node(
        "statement",
        `${pick(scope, TARGETS)} ${pick(scope, ASSIGNMENT_OPERATORS)} `,
        createExpression(scope, 2),
        ";",
      );
    case 2:
      return node("statement", `trace += "s${identifier}";`);
    case 3:
      return createTransfer(scope);
    case 4:
      return scope.grammar === "heap"
        ? createHeapStatement(scope)
        : node("statement", `${pick(scope, TARGETS)} = `, createExpression(scope, 2), ";");
    case 5:
      return node("statement", "trace += ", createExpression(scope, 1), ";");
    case 6:
      return node(
        "statement",
        "if (",
        createExpression(scope, 2),
        ") ",
        createBlock(inner),
        ...(scope.getRandom(2) ? [" else ", createBlock(inner)] : []),
      );
    case 7:
      return createSwitch(scope);
    case 8:
    case 9:
      return createLoop(scope, identifier);
    case 10:
      return createTry(scope);
    case 11: {
      const name = pick(scope, ["alpha", "beta", "total"]);
      return node(
        "statement",
        "{ ",
        node("statement", `let ${name} = `, createExpression(scope, 1), ";"),
        ...createStatements(inner, 1, 3),
        "}",
      );
    }
    case 12:
      return node(
        "statement",
        `label${identifier}: `,
        createBlock({ ...inner, labels: [...scope.labels, `label${identifier}`] }),
      );
    case 14:
      return createShadow(scope);
    default: {
      const name = scope.grammar === "heap" ? `capture${identifier}` : `copy${identifier}`;
      const initializer =
        scope.grammar === "heap"
          ? node("statement", `const ${name} = () => `, createExpression(scope, 2), ";")
          : node("statement", `const ${name} = `, createExpression(scope, 1), ";");
      const reader = scope.grammar === "heap" ? `${name}()` : name;
      return node(
        "statement",
        "{ ",
        initializer,
        ...createStatements({ ...inner, names: [...scope.names, reader] }, 1, 3),
        "}",
      );
    }
  }
};

export const createFuzzProgram = (
  getRandom: GetRandom,
  grammar: GeneratedFuzzProgram["grammar"],
): FuzzProgram => {
  const scope: GeneratorScope = {
    getRandom,
    grammar,
    depth: 0,
    isInLoop: false,
    isBreakable: false,
    labels: [],
    loopLabels: [],
    names: INITIAL_NAMES,
    counter: { next: 0 },
  };
  const initialScope: GeneratorScope = {
    ...scope,
    grammar: "scalar",
    names: ["value", "first", "second"],
  };
  const declarations = node(
    "fixed",
    "let alpha = ",
    createLeaf(initialScope),
    ", beta = ",
    createLeaf(initialScope),
    ";\n",
  );
  const statements = [
    ...createStatements(scope, 4, 7),
    node("statement", "return ", createExpression(scope, 2), ";"),
  ];
  const root =
    grammar === "heap"
      ? node("fixed", HEAP_PRELUDE, declarations, HEAP_SETUP, ...statements, HEAP_EPILOGUE)
      : node("fixed", declarations, 'let total = 0, flag = first, trace = "";\n', ...statements);
  return { grammar, root };
};

export const renderFuzzNode = (current: FuzzNode): string =>
  current.parts
    .map((part) => {
      if (typeof part === "string") return part;
      const rendered = renderFuzzNode(part);
      return part.role === "statement" || part.role === "clause" ? `${rendered}\n` : rendered;
    })
    .join("");

const getNodeCount = (current: FuzzNode): number =>
  current.parts.reduce(
    (count, part) => count + (typeof part === "string" ? 0 : getNodeCount(part)),
    1,
  );

export const getFuzzReductions = (root: FuzzNode): FuzzNode[] => {
  const reductions: FuzzNode[] = [];
  const visit = (current: FuzzNode, rebuild: (next: FuzzNode | null) => FuzzNode) => {
    if (current.role === "statement" || current.role === "clause") reductions.push(rebuild(null));
    for (const part of current.parts) {
      if (typeof part === "string") continue;
      if (current.role === "statement" && part.role === "block")
        reductions.push(rebuild(node("statement", ...part.parts)));
      if (current.role === "expression" && part.role === "expression")
        reductions.push(rebuild(part));
    }
    if (current.role === "expression" && renderFuzzNode(current) !== "0")
      reductions.push(rebuild(leaf("0")));
    current.parts.forEach((part, index) => {
      if (typeof part === "string") return;
      visit(part, (next) =>
        rebuild({
          ...current,
          parts: next
            ? current.parts.map((existing, position) => (position === index ? next : existing))
            : current.parts.filter((_, position) => position !== index),
        }),
      );
    });
  };
  visit(root, (next) => next ?? node("fixed"));
  return reductions;
};

const isTimeout = (error: unknown): boolean =>
  types.isNativeError(error) && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";

const getNativeCompletions = (
  source: string,
  input: StaticPrimitive,
): ObservedCompletion[] | null => {
  let script: Script;
  try {
    script = new Script(
      `"use strict"; (function (first, second, value) {\n${source}\n})(...fuzzArguments)`,
    );
  } catch {
    return null;
  }
  const completions: ObservedCompletion[] = [];
  for (const { first, second } of ASSIGNMENTS) {
    // HACK: a contextified global lets strict code assign a function to an undeclared name
    const context = createContext(constants.DONT_CONTEXTIFY);
    context.fuzzArguments = [first, second, input];
    try {
      completions.push({
        kind: "return",
        value: observeNative(script.runInContext(context, { timeout: 1000 })),
      });
    } catch (error) {
      if (isTimeout(error)) return null;
      completions.push({ kind: "throw", value: observeNative(error) });
    }
  }
  return completions;
};

const getUnresolved = (observed: ObservedValue): string | null =>
  observed.text.startsWith("unresolved:")
    ? observed.text.slice("unresolved:".length)
    : ((observed.items ?? []).map(getUnresolved).find((text) => text !== null) ?? null);

const getTypeTag = (observed: ObservedValue): string =>
  observed.text.startsWith("error:") ? observed.text : observed.text.split(":")[0];

const getValueDifference = (
  expected: ObservedValue,
  actual: ObservedValue,
  slot: string,
): string | null => {
  if (expected.text !== actual.text)
    return slot === "completion"
      ? `${slot}:${expected.text}≠${actual.text}`
      : `${slot}:${getTypeTag(expected)}≠${getTypeTag(actual)}`;
  const expectedItems = expected.items ?? [];
  const actualItems = actual.items ?? [];
  if (expectedItems.length !== actualItems.length) return `${slot}:length`;
  for (const [index, item] of expectedItems.entries()) {
    const difference = getValueDifference(item, actualItems[index], slot);
    if (difference) return difference;
  }
  return null;
};

const getCompletionDifference = (
  expected: ObservedCompletion,
  actual: ObservedCompletion,
  grammar: FuzzProgram["grammar"],
): string | null => {
  if (expected.kind !== actual.kind)
    return `completion:${expected.kind} ${getTypeTag(expected.value)}≠${actual.kind} ${getTypeTag(actual.value)}`;
  const expectedItems = expected.value.items;
  const actualItems = actual.value.items;
  if (
    grammar === "heap" &&
    expectedItems?.length === HEAP_SLOTS.length &&
    actualItems?.length === HEAP_SLOTS.length
  ) {
    for (const [index, slot] of HEAP_SLOTS.entries()) {
      const difference = getValueDifference(expectedItems[index], actualItems[index], slot);
      if (difference) return difference;
    }
    return null;
  }
  return getValueDifference(expected.value, actual.value, "value");
};

/** The execution mode a failure must keep while shrinking, e.g. `ast[static captured binding]`. */
const getModeText = (execution: FunctionExecution | null): string => {
  if (!execution) return "unknown";
  const { mode, fallback } = execution;
  return mode === "ast" && fallback ? `ast[${fallback.category} ${fallback.reason}]` : mode;
};

const getSignature = (
  grammar: FuzzProgram["grammar"],
  execution: FunctionExecution | null,
  assignments: FuzzAssignment[],
): string | null => {
  const mode = getModeText(execution);
  let uncertainty: string | null = null;
  for (const { expected, actual } of assignments) {
    if (actual.length === 0) return `${mode}:unreachable`;
    const differences = actual.map((outcome) =>
      getCompletionDifference(expected, outcome, grammar),
    );
    if (differences.every((difference) => difference === null)) continue;
    const unresolved = actual.map((outcome) => getUnresolved(outcome.value)).find(Boolean);
    if (unresolved) uncertainty ??= `unresolved:${unresolved}`;
    else if (differences.includes(null)) uncertainty ??= "imprecise";
    else return `${mode}:mismatch:${differences[0]}`;
  }
  if (grammar === "scalar" && execution?.fallback)
    return `fallback:${execution.fallback.category}:${execution.fallback.reason}`;
  return uncertainty && `${mode}:uncertain:${uncertainty}`;
};

export const isUncertainSignature = (signature: string | null): boolean =>
  signature?.split(":")[1] === "uncertain";

const getCrashText = (crash: unknown): string =>
  crash instanceof Error ? `${crash.name}: ${crash.message.split("\n")[0]}` : String(crash);

const getFuzzSource = (program: FuzzProgram): string => renderFuzzNode(program.root);

/** Null when native execution rejects the program (syntax error or timeout). */
export const evaluateFuzzCase = async ({
  program,
  input,
}: FuzzCase): Promise<FuzzResult | null> => {
  const source = getFuzzSource(program);
  const expected = getNativeCompletions(source, input);
  if (!expected) return null;
  const evaluation: CaseEvaluation = await evaluateCaseOutcomes(
    [
      {
        name: program.grammar,
        body: source,
        arguments: { ...SYMBOLIC_INPUTS, value: primitiveValue(input) },
      },
    ],
    false,
    "",
    {},
    FUZZ_MAX_STEPS,
  ).then(
    ([outcome]) => outcome,
    (crash: unknown) => ({ value: null, crash, execution: null }),
  );
  if (!evaluation.value) {
    const crash = getCrashText(evaluation.crash);
    return { signature: `crash:${crash}`, execution: null, crash, assignments: [] };
  }
  const result = evaluation.value;
  const assignments = ASSIGNMENTS.map(({ first, second }, assignmentIndex) => ({
    first,
    second,
    expected: expected[assignmentIndex],
    actual: observeCompletion(result, getAssignmentGuard(INPUT_GUARDS, [first, second])),
  }));
  return {
    signature: getSignature(program.grammar, evaluation.execution, assignments),
    execution: evaluation.execution,
    crash: null,
    assignments,
  };
};

const getFreeNames = (source: string): Set<string> | null => {
  const names = new Set<string>();
  try {
    const ast = parseSync(`"use strict";\n(function (first, second, value) {\n${source}\n});`, {
      babelrc: false,
      configFile: false,
      sourceType: "script",
    });
    if (!ast) return null;
    traverse(ast, {
      ReferencedIdentifier: (path) => {
        if (path.isIdentifier() && !path.scope.getBinding(path.node.name))
          names.add(path.node.name);
      },
    });
  } catch {
    return null;
  }
  return names;
};

const isFuzzCase = (value: unknown): value is FuzzCase =>
  typeof value === "object" && value !== null && "program" in value && "input" in value;

/**
 * Generation comes from our bounded grammars; shrinking narrows the input, then removes
 * statements, unwraps blocks, and replaces expressions, keeping only candidates that parse and
 * reference no name the original left unbound.
 */
class FuzzCaseArbitrary extends Arbitrary<FuzzCase> {
  constructor(private readonly createProgram: (getRandom: GetRandom) => FuzzProgram) {
    super();
  }

  generate(random: Random): Value<FuzzCase> {
    const getRandom: GetRandom = (limit) => random.nextInt(0, limit - 1);
    const program = this.createProgram(getRandom);
    return new Value({ program, input: FUZZ_INPUTS[getRandom(FUZZ_INPUTS.length)] }, undefined);
  }

  canShrinkWithoutContext(value: unknown): value is FuzzCase {
    return isFuzzCase(value);
  }

  shrink({ program, input }: FuzzCase): Stream<Value<FuzzCase>> {
    const toValue = (fuzzCase: FuzzCase) => new Value(fuzzCase, undefined);
    const simplerInputs = FUZZ_INPUTS.slice(
      0,
      FUZZ_INPUTS.findIndex((candidate) => Object.is(candidate, input)),
    ).map((candidate) => toValue({ program, input: candidate }));
    const size = getNodeCount(program.root);
    const freeNames = getFreeNames(getFuzzSource(program));
    const isScopePreserving = (root: FuzzNode) => {
      const names = getFreeNames(renderFuzzNode(root));
      return names !== null && [...names].every((name) => freeNames?.has(name));
    };
    return Stream.of(...simplerInputs).join(
      stream(getFuzzReductions(program.root).values())
        .filter((root) => getNodeCount(root) <= size && isScopePreserving(root))
        .map((root) => toValue({ program: { ...program, root }, input })),
    );
  }
}

export const getFuzzCaseArbitrary = (
  createProgram: (getRandom: GetRandom) => FuzzProgram,
): Arbitrary<FuzzCase> => new FuzzCaseArbitrary(createProgram);

export const getGeneratedCaseArbitrary = (
  grammar: GeneratedFuzzProgram["grammar"],
): Arbitrary<FuzzCase> =>
  getFuzzCaseArbitrary((getRandom) => createFuzzProgram(getRandom, grammar));

const createCaseEvaluator = () => {
  const cache = new Map<string, Promise<FuzzResult | null>>();
  return (fuzzCase: FuzzCase): Promise<FuzzResult | null> => {
    const key = `${encodePrimitive(fuzzCase.input)}\n${getFuzzSource(fuzzCase.program)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const evaluation = evaluateFuzzCase(fuzzCase);
    cache.set(key, evaluation);
    return evaluation;
  };
};

const isFailureSignature = (signature: string | null, known: Set<string>): signature is string =>
  signature !== null && !isUncertainSignature(signature) && !known.has(signature);

const MAX_SHRINK_MILLISECONDS = 120_000;

/**
 * A failure is a case whose value, exception, or trace differs from native execution. Once one
 * is found, shrinking accepts only candidates with the same signature, so the SSA mode and
 * fallback reason stay intact. After `MAX_SHRINK_MILLISECONDS` every candidate passes, so the
 * smallest failure so far is kept: a large corpus program has thousands of candidates per step.
 */
const checkFuzzProperty = (
  arbitrary: Arbitrary<FuzzCase>,
  parameters: Parameters<[FuzzCase]>,
  known: Set<string>,
  evaluate: (fuzzCase: FuzzCase) => Promise<FuzzResult | null>,
  observe: (signature: string) => void = () => {},
) => {
  let target: string | null = null;
  let shrinkDeadline = Infinity;
  return check(
    asyncProperty(arbitrary, async (fuzzCase) => {
      if (Date.now() > shrinkDeadline) return true;
      const result = await evaluate(fuzzCase);
      pre(result !== null);
      if (!result) return true;
      if (target === null && result.signature) observe(result.signature);
      if (!isFailureSignature(result.signature, known)) return true;
      if (target === null) {
        target = result.signature;
        shrinkDeadline = Date.now() + MAX_SHRINK_MILLISECONDS;
      }
      return result.signature !== target;
    }),
    parameters,
  );
};

/** Finds, shrinks, and returns one failure per new signature over the same generated cases. */
export const runFuzzCampaign = async (
  arbitrary: Arbitrary<FuzzCase>,
  { seed, numRuns, known = new Set() }: FuzzCampaignOptions,
): Promise<FuzzCampaign> => {
  const evaluate = createCaseEvaluator();
  const excluded = new Set(known);
  const failures: FuzzFailure[] = [];
  for (;;) {
    const observed = new Map<string, number>();
    const details = await checkFuzzProperty(
      arbitrary,
      { seed, numRuns, maxSkipsPerRun: numRuns },
      excluded,
      evaluate,
      (signature) => observed.set(signature, (observed.get(signature) ?? 0) + 1),
    );
    const fuzzCase = details.counterexample?.[0];
    const result = fuzzCase && (await evaluate(fuzzCase));
    if (!fuzzCase || !result?.signature) return { failures, observed };
    excluded.add(result.signature);
    failures.push({
      ...fuzzCase,
      result,
      seed: details.seed,
      path: details.counterexamplePath ?? "",
    });
  }
};

/** Shrinks a known failing case, e.g. one built by hand or loaded from a repro. */
export const shrinkFuzzCase = async (
  arbitrary: Arbitrary<FuzzCase>,
  fuzzCase: FuzzCase,
): Promise<FuzzFailure | null> => {
  const evaluate = createCaseEvaluator();
  const details = await checkFuzzProperty(
    arbitrary,
    { numRuns: 0, examples: [[fuzzCase]] },
    new Set(),
    evaluate,
  );
  const shrunk = details.counterexample?.[0];
  const result = shrunk && (await evaluate(shrunk));
  return shrunk && result
    ? { ...shrunk, result, seed: details.seed, path: details.counterexamplePath ?? "" }
    : null;
};

/** Replays a campaign failure from its fast-check seed and path. */
export const replayFuzzFailure = async (
  arbitrary: Arbitrary<FuzzCase>,
  { seed, path }: Pick<FuzzFailure, "seed" | "path">,
): Promise<FuzzCase | null> => {
  const details = await checkFuzzProperty(
    arbitrary,
    { seed, path, numRuns: 1 },
    new Set(),
    createCaseEvaluator(),
  );
  return details.counterexample?.[0] ?? null;
};

export const getFuzzRepro = (failure: FuzzFailure): FuzzRepro => ({
  seed: failure.seed,
  path: failure.path,
  grammar: failure.program.grammar,
  signature: failure.result.signature ?? "",
  mode: failure.result.execution?.mode ?? "unknown",
  fallback: failure.result.execution?.fallback ?? null,
  input: encodePrimitive(failure.input),
  source: getFuzzSource(failure.program),
  assignments: failure.result.assignments,
  ...(failure.program.origin ? { origin: failure.program.origin } : {}),
});

export const getReproFileName = (repro: Pick<FuzzRepro, "grammar" | "signature">): string =>
  `${repro.grammar}-${createHash("sha256").update(repro.signature).digest("hex").slice(0, 10)}.json`;

export const persistFuzzRepro = (repro: FuzzRepro, directory = FUZZ_REPRO_DIRECTORY): string => {
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, getReproFileName(repro));
  if (!existsSync(filePath)) writeFileSync(filePath, `${JSON.stringify(repro, null, 2)}\n`);
  return filePath;
};

export const loadFuzzRepros = (directory = FUZZ_REPRO_DIRECTORY): FuzzRepro[] =>
  existsSync(directory)
    ? readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .map((fileName) => JSON.parse(readFileSync(join(directory, fileName), "utf8")))
    : [];

export const replayFuzzRepro = (repro: FuzzRepro): Promise<FuzzResult | null> => {
  return evaluateFuzzCase({
    program: { grammar: repro.grammar, root: node("fixed", repro.source) },
    input: decodePrimitive(repro.input),
  });
};
