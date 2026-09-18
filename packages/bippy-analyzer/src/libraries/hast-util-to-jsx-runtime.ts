import {
  UNDEFINED_VALUE,
  getObjectProperty,
  isUndefinedValue,
  listValue,
  objectValue,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { element, nativeFunction } from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  LibraryValueProvider,
  ModeledExports,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
} from "../types.js";

export const HAST_JSX_RUNTIME_PACKAGES = ["hast-util-to-jsx-runtime"];
export const HAST_JSX_RUNTIME_MODELED_EXPORTS: ModeledExports = {
  "hast-util-to-jsx-runtime": ["toJsxRuntime"],
};

export interface HastJsxRuntimeOptions {
  components: StaticValue;
  fragment: StaticValue;
  passKeys: boolean;
  passNode: boolean;
}

const getString = (value: StaticValue): string | null =>
  value.kind === "primitive" && typeof value.value === "string" ? value.value : null;

const getBoolean = (value: StaticValue, fallback: boolean): boolean =>
  value.kind === "primitive" && typeof value.value === "boolean" ? value.value : fallback;

const getChildren = (node: StaticObjectValue): StaticValue[] | null => {
  const children = getObjectProperty(node, "children");
  if (children.kind === "list") return children.items;
  return isUndefinedValue(children) ? [] : null;
};

const getChildKeyName = (child: StaticValue): string | null => {
  if (child.kind !== "object") return null;
  const nodeType = getString(getObjectProperty(child, "type"));
  if (nodeType === "element") return getString(getObjectProperty(child, "tagName"));
  if (nodeType === "mdxJsxFlowElement" || nodeType === "mdxJsxTextElement") {
    return getString(getObjectProperty(child, "name"));
  }
  return null;
};

const getElementChildren = (
  node: StaticObjectValue,
  state: HastJsxRuntimeOptions,
): StaticValue => {
  const children = getChildren(node);
  if (children === null) return unknownValue("dynamic hast children");
  const countsByName = new Map<string, number>();
  const rendered = children.map((child) => {
    const name = state.passKeys ? getChildKeyName(child) : null;
    const count = name === null ? null : (countsByName.get(name) ?? 0);
    if (name !== null && count !== null) countsByName.set(name, count + 1);
    return renderNode(child, name === null || count === null ? null : `${name}-${count}`, state);
  });
  if (rendered.length === 0) return UNDEFINED_VALUE;
  return rendered.length === 1 ? rendered[0] : listValue(rendered);
};

const getComponent = (components: StaticValue, tagName: string): StaticValue => {
  if (components.kind !== "object") return primitiveValue(tagName);
  const component = getObjectProperty(components, tagName);
  return isUndefinedValue(component) ? primitiveValue(tagName) : component;
};

const getElementProps = (
  node: StaticObjectValue,
  children: StaticValue,
  isCustomComponent: boolean,
  state: HastJsxRuntimeOptions,
): StaticObjectValue => {
  const properties = getObjectProperty(node, "properties");
  const entries: StaticObjectEntry[] =
    properties.kind === "object" ? [{ kind: "spread", value: properties }] : [];
  if (!isUndefinedValue(children)) {
    entries.push({ kind: "property", key: "children", value: children });
  }
  if (isCustomComponent && state.passNode) {
    entries.push({ kind: "property", key: "node", value: node });
  }
  return objectValue(entries);
};

const renderNode = (
  value: StaticValue,
  key: string | null,
  state: HastJsxRuntimeOptions,
): StaticValue => {
  if (value.kind !== "object") return unknownValue("dynamic hast node");
  const nodeType = getString(getObjectProperty(value, "type"));
  if (nodeType === "text") return getObjectProperty(value, "value");
  if (nodeType === "root") {
    const children = getElementChildren(value, state);
    return element(
      toElementType(state.fragment, "Fragment"),
      objectValue(
        isUndefinedValue(children)
          ? []
          : [{ kind: "property", key: "children", value: children }],
      ),
    );
  }
  if (nodeType !== "element") return unknownValue(`unsupported hast node ${nodeType ?? "type"}`);
  const tagName = getString(getObjectProperty(value, "tagName"));
  if (tagName === null) return unknownValue("dynamic hast tag name");
  const component = getComponent(state.components, tagName);
  const isCustomComponent =
    component.kind !== "primitive" || component.value !== tagName;
  const children = getElementChildren(value, state);
  return element(
    toElementType(component, tagName),
    getElementProps(value, children, isCustomComponent, state),
    key === null ? null : primitiveValue(key),
  );
};

const toJsxRuntime = ([tree, options]: StaticValue[]): StaticValue => {
  if (tree?.kind !== "object" || options?.kind !== "object") {
    return unknownValue("dynamic hast JSX runtime input");
  }
  const state: HastJsxRuntimeOptions = {
    components: getObjectProperty(options, "components"),
    fragment: getObjectProperty(options, "Fragment"),
    passKeys: getBoolean(getObjectProperty(options, "passKeys"), true),
    passNode: getBoolean(getObjectProperty(options, "passNode"), false),
  };
  return renderHast(tree, state);
};

export const renderHast = (tree: StaticValue, options: HastJsxRuntimeOptions): StaticValue =>
  renderNode(tree, null, options);

export const hastJsxRuntimeValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "hast-util-to-jsx-runtime" && importedName === "toJsxRuntime"
    ? nativeFunction("toJsxRuntime", toJsxRuntime)
    : null;
