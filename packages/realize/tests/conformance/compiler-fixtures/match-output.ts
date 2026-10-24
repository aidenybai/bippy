import type { SymbolicValue } from "../../../src/core/types";
import { toExpected } from "../verifier/match";
import type { ExpectedShape } from "../verifier/match";

type OutputShape =
  | { kind: "element"; tag: string; children: OutputShape[] }
  | { kind: "text"; text: string };

type ExpectedToken =
  | { kind: "char"; char: string }
  | { kind: "element"; tag: string; children: ExpectedToken[] }
  | { kind: "hole" }
  | { kind: "repeat"; item: ExpectedToken[] }
  | { kind: "choice"; options: ExpectedToken[][] };

type OutputToken =
  | { kind: "char"; char: string }
  | { kind: "element"; tag: string; children: OutputToken[] };

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#x27;", "'"],
  ["&#39;", "'"],
  ["&nbsp;", " "],
]);

const TAG_PATTERN =
  /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+/g;

const MAX_MATCH_STEPS = 500_000;

const decode = (text: string): string =>
  text.replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (entity) => ENTITIES.get(entity) ?? entity);

export const parseHtml = (html: string): OutputShape[] => {
  const root: OutputShape[] = [];
  const stack: OutputShape[][] = [root];
  for (const [token, closing, tag, , selfClosing] of html.matchAll(TAG_PATTERN)) {
    const siblings = stack.at(-1);
    if (!siblings) break;
    if (tag === undefined) {
      siblings.push({ kind: "text", text: decode(token) });
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    const children: OutputShape[] = [];
    siblings.push({ kind: "element", tag: tag.toLowerCase(), children });
    if (!selfClosing && !VOID_TAGS.has(tag.toLowerCase())) stack.push(children);
  }
  return root;
};

const toChars = (text: string): Array<{ kind: "char"; char: string }> =>
  [...text.replace(/\s+/g, "")].map((char) => ({ kind: "char", char }));

const toOutputTokens = (shapes: OutputShape[]): OutputToken[] =>
  shapes.flatMap((shape): OutputToken[] =>
    shape.kind === "text"
      ? toChars(shape.text)
      : [{ kind: "element", tag: shape.tag, children: toOutputTokens(shape.children) }],
  );

const toExpectedTokens = (shapes: ExpectedShape[]): ExpectedToken[] =>
  shapes.flatMap((shape): ExpectedToken[] => {
    switch (shape.kind) {
      case "text":
        return toChars(shape.text);
      case "element":
        return [{ kind: "element", tag: shape.tag, children: toExpectedTokens(shape.children) }];
      case "component":
      case "hole":
        return [{ kind: "hole" }];
      case "repeat":
        return [{ kind: "repeat", item: toExpectedTokens(shape.item) }];
      case "choice":
        return [{ kind: "choice", options: shape.options.map(toExpectedTokens) }];
      default:
        return [{ kind: "hole" }];
    }
  });

interface MatchBudget {
  steps: number;
}

const matchToken = (expected: ExpectedToken, actual: OutputToken, budget: MatchBudget): boolean => {
  if (expected.kind === "char") return actual.kind === "char" && actual.char === expected.char;
  return (
    expected.kind === "element" &&
    actual.kind === "element" &&
    actual.tag === expected.tag &&
    matchTokens(expected.children, actual.children, budget)
  );
};

const matchTokens = (
  expected: ExpectedToken[],
  actual: OutputToken[],
  budget: MatchBudget,
): boolean => {
  budget.steps++;
  if (budget.steps > MAX_MATCH_STEPS) return true;
  const [first, ...restExpected] = expected;
  if (!first) return actual.length === 0;
  if (first.kind === "hole") {
    for (let taken = 0; taken <= actual.length; taken++)
      if (matchTokens(restExpected, actual.slice(taken), budget)) return true;
    return false;
  }
  if (first.kind === "choice")
    return first.options.some((option) =>
      matchTokens([...option, ...restExpected], actual, budget),
    );
  if (first.kind === "repeat") {
    if (matchTokens(restExpected, actual, budget)) return true;
    if (first.item.length === 0) return false;
    for (let taken = 1; taken <= actual.length; taken++)
      if (
        matchTokens(first.item, actual.slice(0, taken), budget) &&
        matchTokens([first, ...restExpected], actual.slice(taken), budget)
      )
        return true;
    return false;
  }
  const [head, ...restActual] = actual;
  return (
    head !== undefined &&
    matchToken(first, head, budget) &&
    matchTokens(restExpected, restActual, budget)
  );
};

const HOLE: ExpectedToken[] = [{ kind: "hole" }];

const toJsonTokens = (value: SymbolicValue, seen = new Set<SymbolicValue>()): ExpectedToken[] => {
  if (seen.has(value)) return HOLE;
  if (value.kind === "ArrayExpression" || value.kind === "ObjectExpression") seen.add(value);
  switch (value.kind) {
    case "Primitive":
      return toChars(JSON.stringify(value.value) ?? "null");
    case "ArrayExpression":
      if (value.spreads.length > 0) return HOLE;
      return [
        ...toChars("["),
        ...value.elements.flatMap((element, index) => [
          ...(index > 0 ? toChars(",") : []),
          ...toJsonTokens(element, seen),
        ]),
        ...toChars("]"),
      ];
    case "ObjectExpression": {
      const isPresent = (property: SymbolicValue): boolean | null => {
        if (property.kind === "Primitive") return property.value !== undefined;
        return property.kind === "ArrayExpression" || property.kind === "ObjectExpression"
          ? true
          : null;
      };
      const properties = value.properties.filter((property) => isPresent(property.value) !== false);
      if (
        value.spreads.length > 0 ||
        properties.some((property) => isPresent(property.value) === null)
      )
        return HOLE;
      return [
        ...toChars("{"),
        ...properties.flatMap((property, index) => [
          ...(index > 0 ? toChars(",") : []),
          ...toChars(`${JSON.stringify(property.key)}:`),
          ...toJsonTokens(property.value, seen),
        ]),
        ...toChars("}"),
      ];
    }
    case "Conditional":
      return [
        {
          kind: "choice",
          options: [toJsonTokens(value.consequent, seen), toJsonTokens(value.alternate, seen)],
        },
      ];
    default:
      return HOLE;
  }
};

const toRenderTokens = (value: SymbolicValue): ExpectedToken[] => {
  switch (value.kind) {
    case "JsxExpression":
    case "JsxFragment":
      return toExpectedTokens(toExpected(value, new Map()));
    case "Conditional":
      return [
        {
          kind: "choice",
          options: [toRenderTokens(value.consequent), toRenderTokens(value.alternate)],
        },
      ];
    case "Primitive":
      return value.value === undefined ? [] : toJsonTokens(value);
    case "Unknown":
      return HOLE;
    default:
      return toJsonTokens(value);
  }
};

export const admitsOutput = (renders: SymbolicValue[], html: string): boolean => {
  const actual = toOutputTokens(parseHtml(html));
  return renders.some((render) => matchTokens(toRenderTokens(render), actual, { steps: 0 }));
};

export const admitsSequentialOutput = (renders: SymbolicValue[], html: string): boolean =>
  matchTokens(
    [{ kind: "repeat", item: [{ kind: "choice", options: renders.map(toRenderTokens) }] }],
    toOutputTokens(parseHtml(html)),
    { steps: 0 },
  );
