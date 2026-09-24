import type { SourceLocation } from "../parse/source-types.js";
import {
  splitElementKey,
  toElementKey,
  toElementType,
  type SplitElementProps,
} from "../react/element-type.js";
import type {
  ElementOwner,
  RenderEnvironment,
  StaticElementValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import { isElementValue } from "./type-predicates.js";
import {
  describeValue,
  getObjectProperty,
  isNullish,
  listValue,
  mapValue,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export interface ElementCreationContext {
  environment: RenderEnvironment | null;
  owner: ElementOwner | null;
}

export const isValidElementValue = (value: StaticValue): StaticValue => {
  const verdict = isElementValue(value);
  return verdict === null
    ? unknownPrimitiveValue("boolean", "isValidElement on dynamic value")
    : primitiveValue(verdict);
};

const configEntries = (value: StaticValue | undefined): StaticObjectEntry[] => {
  if (!value || isNullish(value) === true) return [];
  return value.kind === "object" ? value.entries : [{ kind: "spread", value }];
};

/** `jsx(type, config, maybeKey)`: `maybeKey` is read first, so a `key` in `config` wins over it. */
export const propsFromValue = (
  config: StaticValue | undefined,
  maybeKey: StaticValue | undefined = UNDEFINED_VALUE,
): SplitElementProps =>
  splitElementKey([{ kind: "property", key: "key", value: maybeKey }, ...configEntries(config)]);

/** `cloneElement(object)` reads `type`, `key` and `props` off any non-nullish object, element or not (react/src/jsx/ReactJSXElement.js). */
const toCloneSource = (
  element: StaticValue,
  location: SourceLocation | null,
): StaticElementValue | null => {
  if (element.kind === "element") return element;
  if (element.kind !== "object") return null;
  const type = getObjectProperty(element, "type");
  const key = getObjectProperty(element, "key");
  return {
    kind: "element",
    type: toElementType(type, null),
    key: isNullish(key) === true ? null : key,
    props: objectValue([{ kind: "spread", value: getObjectProperty(element, "props") }]),
    location,
    environment: null,
    owner: null,
  };
};

export const cloneElement = (
  element: StaticValue,
  props: StaticValue | undefined,
  children: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const source = toCloneSource(element, location);
  if (source === null) return unknownValue(`cloneElement of ${describeValue(element)}`, location);
  const { entries, key } = propsFromValue(props);
  const merged = objectValue([{ kind: "spread", value: source.props }, ...entries]);
  if (children.length === 1)
    merged.entries.push({ kind: "property", key: "children", value: children[0] });
  if (children.length > 1)
    merged.entries.push({ kind: "property", key: "children", value: listValue(children) });
  return {
    kind: "element",
    type: source.type,
    key: toElementKey(key) ?? source.key,
    props: merged,
    location: source.location,
    environment: source.environment,
    owner: source.owner,
  };
};

export const createStaticElement = (
  type: StaticValue,
  props: StaticObjectValue,
  key: StaticValue | null,
  children: StaticValue[],
  location: SourceLocation | null,
  nameHint: string | null,
  context: ElementCreationContext,
): StaticValue => {
  if (children.length === 1) {
    props.entries.push({
      kind: "property",
      key: "children",
      value: children[0],
    });
  } else if (children.length > 1) {
    props.entries.push({
      kind: "property",
      key: "children",
      value: listValue(children),
    });
  }
  const element = (
    elementType: StaticValue,
    elementKey: StaticValue | null,
  ): StaticElementValue => ({
    kind: "element",
    type: toElementType(elementType, nameHint),
    key: toElementKey(elementKey),
    props,
    location,
    environment: context.environment,
    owner: context.owner,
  });
  return mapValue(type, (elementType) =>
    key?.kind === "branch"
      ? mapValue(key, (alternative) => element(elementType, alternative))
      : element(elementType, key),
  );
};
