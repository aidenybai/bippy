import { parseSync, types } from "@babel/core";
import type { Arbitrary } from "fast-check";
import type { CorpusFunction, CorpusParameter } from "./corpus-extraction.js";
import {
  getFuzzCaseArbitrary,
  type FuzzCase,
  type FuzzNode,
  type FuzzProgram,
  type GetRandom,
} from "./program-fuzzer.js";

interface SourceChild {
  node: types.Node;
  role: FuzzNode["role"];
}

const TYPED_POOLS: Record<Exclude<CorpusParameter["kind"], "any">, string[]> = {
  string: [
    '""',
    '"a"',
    '"hello world"',
    '"Foo-Bar_baz qux"',
    '"  padded  "',
    '"42"',
    '"-3.5e2"',
    '"café ☕"',
    '"a,b,,c"',
    '"<b class=\\"x\\">&amp;</b>"',
    '"camelCaseString"',
    '"https://example.com/a/b?c=1&d=two#frag"',
    '"user@example.com"',
    '"\\n\\t"',
    '"ABC"',
    '"#ff8800"',
    '"rgb(255, 0, 128)"',
    '"10px"',
    '"a.b[0].c"',
  ],
  number: [
    "0",
    "1",
    "(-1)",
    "2.5",
    "42",
    "(-0)",
    "NaN",
    "Infinity",
    "255",
    "0.1",
    "1e21",
    "3",
    "(-17)",
    "1024",
  ],
  boolean: ["true", "false"],
  array: [
    "[]",
    "[1, 2, 3]",
    '["b", "a", "c"]',
    "[3, 1, 2, 1]",
    '[{ id: 1, name: "a" }, { id: 2, name: "b" }]',
    "[[1, 2], [3, [4]]]",
    '[0, "", null, undefined, 1, NaN]',
    '["a", 1, true]',
  ],
  object: [
    "{}",
    '{ a: 1, b: "two" }',
    "{ a: { b: { c: 3 } } }",
    '{ id: 1, tags: ["x", "y"] }',
    '{ name: "Ada", age: 36, active: true }',
    "{ x: 1, y: 2 }",
  ],
  function: [
    "(item) => item",
    "(left, right) => left - right",
    '(item) => typeof item === "number" ? item * 2 : String(item)',
    "(item) => !!item",
    "(total, item) => total + item",
    "(item, index) => [index, item]",
  ],
};
const ANY_POOL = [...Object.values(TYPED_POOLS).flat(), "null", "undefined", "value"];
const DESCRIBE_SOURCE = `const describeCorpusValue = (item, depth) => {
  if (typeof item === "function") return "function";
  if (typeof item !== "object" || item === null) return item;
  if (item instanceof Error) return "error:" + item.name;
  if (depth > 3) return "object";
  const describeAll = (entries) => entries.slice(0, 24).map((entry) => describeCorpusValue(entry, depth + 1));
  if (Array.isArray(item)) return ["array", item.length, ...describeAll(item)];
  if (item instanceof Map) return ["map", item.size, ...describeAll([...item])];
  if (item instanceof Set) return ["set", item.size, ...describeAll([...item])];
  return ["object", ...describeAll(Object.keys(item).map((key) => [key, item[key]]))];
};
`;
const STATEMENT_LISTS = new Set(["Program", "BlockStatement", "StaticBlock", "SwitchCase"]);
const UNREPLACEABLE = new Set(["Super", "Import", "ArgumentPlaceholder"]);

const getArgument = (getRandom: GetRandom, parameter: CorpusParameter): string => {
  const pick = (items: string[]) => items[getRandom(items.length)];
  const getSingle = () => {
    if (parameter.literals.length && getRandom(4)) return pick(parameter.literals);
    if (parameter.kind === "any" || getRandom(4) === 0) return pick(ANY_POOL);
    return pick(TYPED_POOLS[parameter.kind]);
  };
  return getRandom(4) === 0 ? `(first ? ${getSingle()} : ${getSingle()})` : getSingle();
};

const getArguments = (getRandom: GetRandom, parameters: CorpusParameter[]) =>
  parameters.flatMap((parameter) =>
    Array.from({ length: parameter.isRest ? getRandom(3) : 1 }, () =>
      getArgument(getRandom, parameter),
    ),
  );

const getExpressionRole = (node: types.Node, parent: types.Node, key: string): FuzzNode["role"] => {
  if (!types.isExpression(node) || UNREPLACEABLE.has(node.type)) return "fixed";
  if (types.isIdentifier(node) && !types.isReferenced(node, parent)) return "fixed";
  if (key === "left" && (types.isAssignmentExpression(parent) || types.isForXStatement(parent)))
    return "fixed";
  return types.isUpdateExpression(parent) ? "fixed" : "expression";
};

const getRole = (
  node: types.Node,
  parent: types.Node,
  key: string,
  isListed: boolean,
): FuzzNode["role"] => {
  if (types.isSwitchCase(node)) return "clause";
  if (isListed && STATEMENT_LISTS.has(parent.type) && types.isStatement(node)) return "statement";
  if (types.isBlockStatement(node) && types.isStatement(parent) && !types.isFunction(parent))
    return "block";
  return getExpressionRole(node, parent, key);
};

const getSourceChildren = (node: types.Node): SourceChild[] => {
  const keys = types.VISITOR_KEYS[node.type] ?? [];
  return Object.entries(node)
    .filter(([key]) => keys.includes(key))
    .flatMap(([key, value]) => {
      const isListed = Array.isArray(value);
      const candidates: unknown[] = isListed ? value : [value];
      return candidates
        .filter((candidate) => types.isNode(candidate))
        .map((child) => ({ node: child, role: getRole(child, node, key, isListed) }));
    })
    .sort((left, right) => (left.node.start ?? 0) - (right.node.start ?? 0));
};

const buildSourceNode = (source: string, node: types.Node, role: FuzzNode["role"]): FuzzNode => {
  const parts: FuzzNode["parts"] = [];
  let cursor = node.start ?? 0;
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts.at(-1);
    if (typeof last === "string") parts[parts.length - 1] = last + text;
    else parts.push(text);
  };
  for (const child of getSourceChildren(node)) {
    if ((child.node.start ?? 0) < cursor) continue;
    pushText(source.slice(cursor, child.node.start ?? cursor));
    const built = buildSourceNode(source, child.node, child.role);
    if (built.role === "fixed" && built.parts.every((part) => typeof part === "string"))
      pushText(built.parts.join(""));
    else parts.push(built);
    cursor = child.node.end ?? cursor;
  }
  pushText(source.slice(cursor, node.end ?? cursor));
  return { role, parts };
};

/** A shrinkable tree whose rendering reproduces `source` up to statement newlines. */
export const createSourceTree = (source: string): FuzzNode => {
  const ast = parseSync(source, {
    babelrc: false,
    configFile: false,
    sourceType: "script",
    parserOpts: { allowReturnOutsideFunction: true },
  });
  if (!ast) throw new Error("Corpus program did not parse");
  return buildSourceNode(source, ast.program, "fixed");
};

export const getCorpusProgramSource = (
  corpusFunction: CorpusFunction,
  argumentSources: string[],
): string =>
  `${corpusFunction.source}const corpusArguments = [${argumentSources.join(", ")}];\n${DESCRIBE_SOURCE}return describeCorpusValue([corpusTarget(...corpusArguments), corpusArguments], 0);\n`;

export const createCorpusProgram = (
  getRandom: GetRandom,
  functions: CorpusFunction[],
): FuzzProgram => {
  const corpusFunction = functions[getRandom(functions.length)];
  const source = getCorpusProgramSource(
    corpusFunction,
    getArguments(getRandom, corpusFunction.parameters),
  );
  return { grammar: "corpus", root: createSourceTree(source), origin: corpusFunction.origin };
};

export const getCorpusCaseArbitrary = (functions: CorpusFunction[]): Arbitrary<FuzzCase> =>
  getFuzzCaseArbitrary((getRandom) => createCorpusProgram(getRandom, functions));
