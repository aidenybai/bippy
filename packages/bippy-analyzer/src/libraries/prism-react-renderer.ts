import { createRequire } from "node:module";
import { fromNativeValue } from "../evaluate/native-values.js";
import { element, nativeFunction, stubValue } from "../evaluate/stubs.js";
import {
  getObjectProperty,
  objectFromRecord,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { toElementType } from "../react/element-type.js";
import type { LibraryValueProvider, ModeledExports, StaticValue, StubComponent } from "../types.js";

interface NormalizedPrismToken {
  types: string[];
  content: string;
  empty?: boolean;
}

export const PRISM_REACT_RENDERER_PACKAGES = ["prism-react-renderer"];
export const PRISM_REACT_RENDERER_MODELED_EXPORTS: ModeledExports = {
  "prism-react-renderer": ["Highlight"],
};

const getString = (value: StaticValue): string | null =>
  value.kind === "primitive" && typeof value.value === "string" ? value.value : null;

const appendType = (types: string[], type: string): string[] =>
  types.at(-1) === type ? types : [...types, type];

const getAliases = (alias: unknown): string[] =>
  typeof alias === "string"
    ? [alias]
    : Array.isArray(alias)
      ? alias.filter((item): item is string => typeof item === "string")
      : [];

const normalizeEmptyLine = (line: NormalizedPrismToken[]): void => {
  if (line.length === 0) {
    line.push({ types: ["plain"], content: "\n", empty: true });
  } else if (line.length === 1 && line[0].content === "") {
    line[0].content = "\n";
    line[0].empty = true;
  }
};

const appendText = (text: string, types: string[], lines: NormalizedPrismToken[][]): void => {
  const parts = text.split(/\r\n|\r|\n/);
  lines.at(-1)?.push({ types: types.length === 0 ? ["plain"] : types, content: parts[0] });
  for (const part of parts.slice(1)) {
    const currentLine = lines.at(-1);
    if (currentLine) normalizeEmptyLine(currentLine);
    lines.push([{ types: types.length === 0 ? ["plain"] : types, content: part }]);
  }
};

const appendToken = (
  token: unknown,
  parentTypes: string[],
  lines: NormalizedPrismToken[][],
): void => {
  if (typeof token === "string") {
    appendText(token, parentTypes, lines);
    return;
  }
  if (Array.isArray(token)) {
    for (const childToken of token) appendToken(childToken, parentTypes, lines);
    return;
  }
  if (typeof token !== "object" || token === null) return;
  const type = Reflect.get(token, "type");
  const content = Reflect.get(token, "content");
  if (typeof type !== "string") return;
  const types = getAliases(Reflect.get(token, "alias")).reduce(
    appendType,
    appendType(parentTypes, type),
  );
  appendToken(content, types, lines);
};

const normalizePrismTokens = (tokens: unknown[]): NormalizedPrismToken[][] => {
  const lines: NormalizedPrismToken[][] = [[]];
  appendToken(tokens, [], lines);
  const currentLine = lines.at(-1);
  if (currentLine) normalizeEmptyLine(currentLine);
  return lines;
};

const require = createRequire(import.meta.url);
const Prism = require("prismjs");
require("prismjs/components/prism-jsx.js");
require("prismjs/components/prism-typescript.js");
require("prismjs/components/prism-tsx.js");

const getTokenClassName = (token: StaticValue): StaticValue => {
  if (token.kind !== "object") return unknownValue("Prism token class name");
  const types = getObjectProperty(token, "types");
  if (types.kind !== "list") return unknownValue("Prism token class name");
  const names = types.items.map(getString);
  return names.every((name) => name !== null)
    ? primitiveValue(["token", ...names].join(" "))
    : unknownValue("Prism token class name");
};

const GET_LINE_PROPS = nativeFunction("getLineProps", () =>
  objectFromRecord({ className: primitiveValue("token-line") }),
);

const GET_TOKEN_PROPS = nativeFunction("getTokenProps", ([input]) => {
  if (input?.kind !== "object") return unknownValue("Prism token props");
  const token = getObjectProperty(input, "token");
  if (token.kind !== "object") return unknownValue("Prism token props");
  return objectFromRecord({
    className: getTokenClassName(token),
    children: getObjectProperty(token, "content"),
  });
});

const HIGHLIGHT_STUB: StubComponent = {
  displayName: "Highlight",
  render: (props, tools) => {
    const code = getString(getObjectProperty(props, "code"));
    const language = getString(getObjectProperty(props, "language"))?.toLowerCase();
    const children = getObjectProperty(props, "children");
    if (code === null || language === undefined || children.kind !== "function") {
      return unknownValue("dynamic Prism highlight");
    }
    const grammar = Prism.languages[language];
    const tokenLines = normalizePrismTokens(grammar ? Prism.tokenize(code, grammar) : [code]);
    return tools.call(children, [
      objectFromRecord({
        tokens: fromNativeValue(tokenLines, "Prism tokens", null),
        className: primitiveValue(`prism-code language-${language}`),
        style: objectFromRecord({}),
        getLineProps: GET_LINE_PROPS,
        getTokenProps: GET_TOKEN_PROPS,
      }),
    ]);
  },
};

const HIGHLIGHT_EXPORT_STUB: StubComponent = {
  displayName: "Highlight2",
  render: (props) => element(toElementType(stubValue(HIGHLIGHT_STUB), null), props),
};

export const prismReactRendererValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "prism-react-renderer" && importedName === "Highlight"
    ? stubValue(HIGHLIGHT_EXPORT_STUB)
    : null;
