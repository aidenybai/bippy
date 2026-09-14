import {
  TRUE_VALUE,
  UNDEFINED_VALUE,
  countAlternatives,
  getObjectProperty,
  getTruthiness,
  listValue,
  mapValue,
  objectFromRecord,
  objectValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type {
  LibraryValueProvider,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
} from "../types.js";

// `@stylexjs/babel-plugin` compiles `create`, `keyframes`, `defineVars`,
// `createTheme` and the marker helpers away: the running app holds compiled
// style objects (`{ [hashedKey]: className, $$css }`, a dynamic namespace being
// a function returning `[compiledStyles, inlineVariables]`) and calling the
// source form throws. Only `props` runs: styleq skips nullish/false arguments,
// flattens arrays, joins the class names of `$$css` objects and merges the rest
// as inline style, yielding `{ className?, style?, 'data-style-src'? }` (the
// dev build stores the source location in `$$css` and surfaces it as the data
// attribute). Hashed keys, class names and variable names exist only in the build.

export const STYLEX_PACKAGES = ["@stylexjs/stylex"];

const MAX_DISTRIBUTED_STYLES = 16;

const compiledStyle = (): StaticObjectValue =>
  objectValue([
    { kind: "spread", value: unknownValue("stylex compiled class names") },
    { kind: "property", key: "$$css", value: TRUE_VALUE },
  ]);

const inlineVariables = (): StaticObjectValue =>
  objectValue([{ kind: "spread", value: unknownValue("stylex inline style variables") }]);

const compileNamespace = (namespace: StaticValue): StaticValue =>
  namespace.kind === "function" || namespace.kind === "native-function"
    ? nativeFunction("stylex dynamic style", () => listValue([compiledStyle(), inlineVariables()]))
    : compiledStyle();

const mapProperties = (
  object: StaticValue,
  transform: (value: StaticValue) => StaticValue,
  reason: string,
): StaticValue =>
  object.kind === "object"
    ? objectValue(
        object.entries.map((entry): StaticObjectEntry =>
          entry.kind === "property"
            ? { kind: "property", key: entry.key, value: transform(entry.value) }
            : entry,
        ),
      )
    : unknownValue(reason);

const variableReference = (): StaticValue =>
  unknownPrimitiveValue("string", "stylex variable reference");

const defineVariables = (variables: StaticValue): StaticValue => {
  const references = mapProperties(variables, variableReference, "stylex.defineVars variables");
  return references.kind === "object"
    ? objectValue([
        ...references.entries,
        {
          kind: "property",
          key: "__varGroupHash__",
          value: unknownPrimitiveValue("string", "stylex variable group hash"),
        },
      ])
    : references;
};

const flattenStyles = (styles: StaticValue[]): StaticValue[] =>
  styles.flatMap((style) => (style.kind === "list" ? flattenStyles(style.items) : [style]));

const isCompiledStyle = (style: StaticObjectValue): boolean =>
  getTruthiness(getObjectProperty(style, "$$css")) === true;

/** A string the build produces (`hasClassNames`), absent (`false`), or either (`null`). */
const buildString = (
  key: string,
  hasClassNames: boolean | null,
  reason: string,
): StaticObjectEntry[] =>
  hasClassNames === false
    ? []
    : [
        {
          kind: "property",
          key,
          value: hasClassNames ? unknownPrimitiveValue("string", reason) : unknownValue(reason),
        },
      ];

const mergeStyles = (styles: StaticValue[]): StaticObjectValue => {
  let hasClassNames: boolean | null = false;
  let inlineStyles: StaticValue[] | null = [];
  for (const style of styles) {
    if (style.kind === "primitive") continue;
    if (style.kind === "object") {
      if (isCompiledStyle(style)) hasClassNames = true;
      else inlineStyles?.push(style);
      continue;
    }
    if (hasClassNames === false) hasClassNames = null;
    inlineStyles = null;
  }
  const entries: StaticObjectEntry[] = [
    ...buildString("className", hasClassNames, "stylex class names"),
  ];
  if (inlineStyles === null) {
    entries.push({ kind: "property", key: "style", value: unknownValue("stylex inline styles") });
  } else if (inlineStyles.length > 0) {
    entries.push({
      kind: "property",
      key: "style",
      value: objectValue(inlineStyles.map((style) => ({ kind: "spread", value: style }))),
    });
  }
  entries.push(...buildString("data-style-src", hasClassNames, "stylex source location"));
  return objectValue(entries);
};

const propsValue = (styles: StaticValue[]): StaticValue => {
  const flattened = flattenStyles(styles);
  const alternativeCount = flattened.reduce(
    (product, style) => product * countAlternatives(style),
    1,
  );
  if (alternativeCount > MAX_DISTRIBUTED_STYLES) return mergeStyles(flattened);
  const branchIndex = flattened.findIndex((style) => style.kind === "branch");
  if (branchIndex === -1) return mergeStyles(flattened);
  return mapValue(flattened[branchIndex], (alternative) =>
    propsValue(flattened.map((style, index) => (index === branchIndex ? alternative : style))),
  );
};

const RELATIONAL_SELECTORS = [
  "ancestor",
  "descendant",
  "siblingBefore",
  "siblingAfter",
  "anySibling",
];

const whenValue = (): StaticValue =>
  objectFromRecord(
    Object.fromEntries(
      RELATIONAL_SELECTORS.map((name) => [
        name,
        nativeFunction(`when.${name}`, () =>
          unknownPrimitiveValue("string", `stylex.when.${name} selector`),
        ),
      ]),
    ),
  );

export const stylexValue: LibraryValueProvider = (specifier, importedName) => {
  if (!STYLEX_PACKAGES.includes(specifier)) return null;
  switch (importedName) {
    case "create":
      return nativeFunction("create", ([styles = UNDEFINED_VALUE]) =>
        mapProperties(styles, compileNamespace, "stylex.create styles"),
      );
    case "props":
      return nativeFunction("props", propsValue);
    case "keyframes":
    case "positionTry":
    case "viewTransitionClass":
      return nativeFunction(importedName, () =>
        unknownPrimitiveValue("string", `stylex.${importedName} name`),
      );
    case "defineVars":
      return nativeFunction("defineVars", ([variables = UNDEFINED_VALUE]) =>
        defineVariables(variables),
      );
    case "createTheme":
    case "defaultMarker":
    case "defineMarker":
      return nativeFunction(importedName, compiledStyle);
    case "when":
      return whenValue();
    default:
      return null;
  }
};
