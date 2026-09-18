import { element, hostElement, nativeFunction, stubValue } from "../evaluate/stubs.js";
import {
  UNDEFINED_VALUE,
  getObjectProperty,
  isUndefinedValue,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
} from "../evaluate/values.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  ModeledExports,
  StaticElementValue,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";

export const NEXT_TRANSLATE_PACKAGES = ["next-translate"];
export const NEXT_TRANSLATE_MODELED_EXPORTS: ModeledExports = {
  "next-translate/Trans": ["default"],
  "next-translate/useTranslation": ["default"],
};

interface TranslationNode {
  children: TranslationChild[];
  name: string | null;
}

interface TranslationChild {
  node?: TranslationNode;
  text?: string;
}

const NEXT_TRANSLATE_CONTEXT: ContextDefinition = {
  name: "NextTranslationContext",
  displayName: "NextTranslationContext",
  defaultValue: UNDEFINED_VALUE,
};

const getString = (value: StaticValue): string | null =>
  value.kind === "primitive" && typeof value.value === "string" ? value.value : null;

const getNestedProperty = (value: StaticValue, path: string): StaticValue => {
  let current = value;
  for (const segment of path.split(".")) {
    if (current.kind !== "object") return UNDEFINED_VALUE;
    current = getObjectProperty(current, segment);
  }
  return current;
};

const getPluralValue = (value: StaticValue, variables: StaticValue): StaticValue => {
  if (value.kind !== "object") return value;
  const count = variables.kind === "object" ? getObjectProperty(variables, "count") : UNDEFINED_VALUE;
  if (count.kind !== "primitive" || typeof count.value !== "number") return UNDEFINED_VALUE;
  const exact = getObjectProperty(value, String(count.value));
  if (!isUndefinedValue(exact)) return exact;
  const category = getObjectProperty(value, count.value === 1 ? "one" : "other");
  return category;
};

const interpolate = (text: string, variables: StaticValue): StaticValue => {
  const pattern = /{{\s*([^},\s]+)[^}]*}}/g;
  let offset = 0;
  let result = "";
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    result += text.slice(offset, match.index);
    const value =
      variables.kind === "object" ? getObjectProperty(variables, match[1]) : UNDEFINED_VALUE;
    if (
      value.kind !== "primitive" ||
      (typeof value.value !== "string" &&
        typeof value.value !== "number" &&
        typeof value.value !== "boolean")
    ) {
      return unknownPrimitiveValue("string", `next-translate interpolation "${match[1]}"`);
    }
    result += String(value.value);
    offset = match.index + match[0].length;
  }
  return primitiveValue(result + text.slice(offset));
};

const getTranslation = (
  context: StaticValue,
  namespace: string,
  key: string,
  variables: StaticValue,
): StaticValue => {
  if (context.kind !== "object") return UNDEFINED_VALUE;
  const namespaces = getObjectProperty(context, "namespaces");
  const resource = getNestedProperty(getObjectProperty(namespaces, namespace), key);
  const selected = getPluralValue(resource, variables);
  const text = getString(selected);
  return text === null ? UNDEFINED_VALUE : interpolate(text, variables);
};

const parseTranslation = (text: string): TranslationNode => {
  const root: TranslationNode = { name: null, children: [] };
  const stack = [root];
  const tagPattern = /<\/?([A-Za-z0-9_-]+)>/g;
  let offset = 0;
  for (let match = tagPattern.exec(text); match; match = tagPattern.exec(text)) {
    const parent = stack[stack.length - 1];
    if (match.index > offset) parent.children.push({ text: text.slice(offset, match.index) });
    if (match[0].startsWith("</")) {
      if (stack.length > 1) stack.pop();
    } else {
      const node: TranslationNode = { name: match[1], children: [] };
      parent.children.push({ node });
      stack.push(node);
    }
    offset = match.index + match[0].length;
  }
  const parent = stack[stack.length - 1];
  if (offset < text.length) parent.children.push({ text: text.slice(offset) });
  return root;
};

const withChildren = (template: StaticElementValue, children: StaticValue): StaticElementValue =>
  element(
    template.type,
    objectValue([
      ...template.props.entries,
      { kind: "property", key: "children", value: children },
    ]),
    template.key,
  );

const renderTranslationNode = (
  node: TranslationNode,
  components: StaticValue,
): StaticValue => {
  const renderedChildren = node.children.map((child) =>
    child.node
      ? renderTranslationNode(child.node, components)
      : primitiveValue(child.text ?? ""),
  );
  const children =
    renderedChildren.length === 0
      ? UNDEFINED_VALUE
      : renderedChildren.length === 1
        ? renderedChildren[0]
        : listValue(renderedChildren);
  if (node.name === null) return children;
  const component =
    components.kind === "object" ? getObjectProperty(components, node.name) : UNDEFINED_VALUE;
  return component.kind === "element"
    ? withChildren(component, children)
    : hostElement(node.name, { children });
};

const renderTrans = (props: StaticObjectValue, context: StaticValue): StaticValue => {
  const i18nKey = getString(getObjectProperty(props, "i18nKey"));
  if (i18nKey === null) return unknownPrimitiveValue("string", "dynamic next-translate key");
  const separator = i18nKey.indexOf(":");
  const namespace = separator === -1 ? "common" : i18nKey.slice(0, separator);
  const key = separator === -1 ? i18nKey : i18nKey.slice(separator + 1);
  const variables = getObjectProperty(props, "values");
  const translation = getTranslation(context, namespace, key, variables);
  const fallback = getObjectProperty(props, "defaultTrans");
  const text = getString(isUndefinedValue(translation) ? fallback : translation);
  if (text === null) return primitiveValue(i18nKey);
  return renderTranslationNode(parseTranslation(text), getObjectProperty(props, "components"));
};

const TRANS_STUB: StubComponent = {
  displayName: "Trans",
  render: (props, tools) => renderTrans(props, tools.readContext(NEXT_TRANSLATE_CONTEXT)),
};

const useTranslation = nativeFunction("useTranslation", ([namespace], tools) => {
  const context = tools.readContext(NEXT_TRANSLATE_CONTEXT);
  const activeNamespace = getString(namespace ?? UNDEFINED_VALUE) ?? "common";
  const translate = nativeFunction("t", ([key, variables = objectValue()]) => {
    const keyName = getString(key ?? UNDEFINED_VALUE);
    if (keyName === null) return unknownPrimitiveValue("string", "dynamic next-translate key");
    const translated = getTranslation(context, activeNamespace, keyName, variables);
    return isUndefinedValue(translated) ? primitiveValue(keyName) : translated;
  });
  return objectFromRecord({
    t: translate,
    lang:
      context.kind === "object"
        ? getObjectProperty(context, "lang")
        : unknownPrimitiveValue("string", "next-translate language"),
  });
});

export const provideNextTranslations = (
  pageProps: StaticValue,
  children: StaticValue,
): StaticValue => {
  if (pageProps.kind !== "object") return children;
  const namespaces = getObjectProperty(pageProps, "__namespaces");
  if (isUndefinedValue(namespaces)) return children;
  return element(
    {
      kind: "context-provider",
      context: NEXT_TRANSLATE_CONTEXT,
      displayName: NEXT_TRANSLATE_CONTEXT.displayName,
    },
    objectFromRecord({
      value: objectFromRecord({
        namespaces,
        lang: getObjectProperty(pageProps, "__lang"),
      }),
      children,
    }),
  );
};

export const nextTranslateValue: LibraryValueProvider = (specifier, importedName) => {
  if (importedName !== "default") return null;
  if (specifier === "next-translate/Trans") return stubValue(TRANS_STUB);
  return specifier === "next-translate/useTranslation" ? useTranslation : null;
};
