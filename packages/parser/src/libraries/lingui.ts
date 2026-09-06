import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  isKnownString,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { element, nativeFunction, stubElement, stubValue } from "../frameworks/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  ContextDefinition,
  ExternalValueProvider,
  StaticElementValue,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";

// Static stand-in for Lingui (@lingui/core, @lingui/react and their `/macro`
// entry points). The macros are a build-time transform: `<Trans>Hi {name}</Trans>`
// becomes `<Trans id message="Hi {0}" values={{0: name}} />`, and at runtime
// `TransNoContext` looks the id up in the active catalog, interpolates the values
// and rebuilds `<0>..</0>` tags from `components` (`formatElements`). The catalog
// is data loaded at runtime, so every translation is a branch between what the
// source message renders to (what a source-locale catalog yields, and Lingui's
// own fallback for a missing entry) and an unknown translated string.

export const LINGUI_PACKAGES = ["@lingui/core", "@lingui/react"];

const LINGUI_CONTEXT: ContextDefinition = {
  name: "LinguiContext",
  displayName: null,
  defaultValue: NULL_VALUE,
  location: null,
};

interface MessageTextToken {
  kind: "text";
  text: string;
}

interface MessageArgumentToken {
  kind: "argument";
  value: StaticValue;
}

interface MessageElementToken {
  kind: "element";
  element: StaticElementValue;
  children: MessageToken[];
}

type MessageToken = MessageTextToken | MessageArgumentToken | MessageElementToken;

/** The `{message, values, components}` a macro expands a message to. */
interface MessageDescriptor {
  message: string;
  values: Record<string, StaticValue>;
  components: Record<string, StaticValue>;
}

/** What `TransNoContext` / `i18n._` receive, as props or arguments. */
interface MessageSource {
  message: StaticValue;
  values: StaticObjectValue;
  components: StaticObjectValue;
}

const UNKNOWN_TRANSLATION = "translation comes from the runtime message catalog";

const isUndefined = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === undefined;

const isNull = (value: StaticValue): boolean => value.kind === "primitive" && value.value === null;

const isFalsyPrimitive = (value: StaticValue): boolean =>
  value.kind === "primitive" && !value.value;

const asObject = (value: StaticValue): StaticObjectValue =>
  value.kind === "object" ? value : objectValue();

const unknownTranslatedString = (): StaticValue =>
  unknownPrimitiveValue("string", UNKNOWN_TRANSLATION);

const translationBranch = (rendered: StaticValue | null, unknown: StaticValue): StaticValue =>
  rendered ? branchValue([rendered, unknown], "lingui catalog may translate the message") : unknown;

// --- macro side: children / template literal -> descriptor -------------------

const tokenizeChildren = (value: StaticValue): MessageToken[] | null => {
  switch (value.kind) {
    case "list": {
      const tokens: MessageToken[] = [];
      for (const item of value.items) {
        const nested = tokenizeChildren(item);
        if (!nested) return null;
        tokens.push(...nested);
      }
      return tokens;
    }
    case "primitive":
      return typeof value.value === "string"
        ? [{ kind: "text", text: value.value }]
        : [{ kind: "argument", value }];
    case "element": {
      const rawChildren = getObjectProperty(value.props, "children");
      const children =
        isUndefined(rawChildren) || isNull(rawChildren) ? [] : tokenizeChildren(rawChildren);
      return children ? [{ kind: "element", element: value, children }] : null;
    }
    default:
      return [{ kind: "argument", value }];
  }
};

const serializeTokens = (tokens: MessageToken[], descriptor: MessageDescriptor): string =>
  tokens
    .map((token) => {
      switch (token.kind) {
        case "text":
          return token.text;
        case "argument": {
          const name = String(Object.keys(descriptor.values).length);
          descriptor.values[name] = token.value;
          return `{${name}}`;
        }
        case "element": {
          const name = String(Object.keys(descriptor.components).length);
          descriptor.components[name] = token.element;
          return token.children.length
            ? `<${name}>${serializeTokens(token.children, descriptor)}</${name}>`
            : `<${name}/>`;
        }
      }
    })
    .join("");

const describeTokens = (tokens: MessageToken[]): MessageDescriptor => {
  const descriptor: MessageDescriptor = { message: "", values: {}, components: {} };
  descriptor.message = serializeTokens(tokens, descriptor);
  return descriptor;
};

const templateTokens = (strings: StaticValue, values: StaticValue[]): MessageToken[] | null => {
  if (strings.kind !== "list") return null;
  const tokens: MessageToken[] = [];
  for (const [index, quasi] of strings.items.entries()) {
    if (!isKnownString(quasi)) return null;
    tokens.push({ kind: "text", text: quasi.value });
    if (index < values.length) tokens.push({ kind: "argument", value: values[index] });
  }
  return tokens;
};

const descriptorFromTemplate = (args: StaticValue[]): MessageDescriptor | null => {
  const [strings, ...values] = args;
  const tokens = strings ? templateTokens(strings, values) : null;
  return tokens ? describeTokens(tokens) : null;
};

const descriptorEntries = (
  descriptor: MessageDescriptor | null,
): Array<{ kind: "property"; key: string; value: StaticValue }> =>
  Object.entries({
    id: unknownPrimitiveValue("string", "lingui message id is a hash of the message"),
    message: descriptor ? primitiveValue(descriptor.message) : unknownTranslatedString(),
    values: objectFromRecord(descriptor?.values ?? {}),
    components: objectFromRecord(descriptor?.components ?? {}),
  }).map(([key, value]) => ({ kind: "property", key, value }));

const descriptorObject = (descriptor: MessageDescriptor | null): StaticObjectValue =>
  objectValue(descriptorEntries(descriptor));

// --- runtime side: message source -> rendered translation --------------------

const TAG_PATTERN = /<([a-zA-Z0-9]+)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9]+)\/>|\{([a-zA-Z0-9_]+)\}/;

const parseMessage = (message: string, source: MessageSource): MessageToken[] | null => {
  const tokens: MessageToken[] = [];
  let rest = message;
  while (rest.length > 0) {
    const match = TAG_PATTERN.exec(rest);
    if (!match) {
      tokens.push({ kind: "text", text: rest });
      break;
    }
    if (match.index > 0) tokens.push({ kind: "text", text: rest.slice(0, match.index) });
    const [, pairedName, inner, unpairedName, argumentName] = match;
    if (argumentName !== undefined) {
      tokens.push({ kind: "argument", value: getObjectProperty(source.values, argumentName) });
    } else {
      const component = getObjectProperty(source.components, pairedName ?? unpairedName);
      if (component.kind !== "element") return null;
      const children = pairedName !== undefined ? parseMessage(inner, source) : [];
      if (!children) return null;
      tokens.push({ kind: "element", element: component, children });
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return tokens;
};

const withKeyAndChildren = (
  cloned: StaticElementValue,
  key: string,
  children: StaticValue,
): StaticElementValue => ({
  ...cloned,
  key: primitiveValue(key),
  props: objectValue([
    ...cloned.props.entries.filter(
      (entry) => entry.kind !== "property" || entry.key !== "children",
    ),
    { kind: "property", key: "children", value: children },
  ]),
});

/**
 * `interpolate` + `formatElements`: string and number values join the text,
 * anything else becomes a keyed Fragment, tagged components are cloned with a
 * key. Null when a value is not known well enough to place it.
 */
const renderTokens = (tokens: MessageToken[]): StaticValue | null => {
  const segments: StaticValue[] = [];
  let text = "";
  let keyCount = 0;
  const nextKey = (): string => `$lingui$_${keyCount++}`;
  const flushText = (): void => {
    if (text) segments.push(primitiveValue(text));
    text = "";
  };
  for (const token of tokens) {
    switch (token.kind) {
      case "text":
        text += token.text;
        break;
      case "argument": {
        const { value } = token;
        if (
          value.kind === "primitive" &&
          (typeof value.value === "string" || typeof value.value === "number")
        ) {
          text += String(value.value);
          break;
        }
        if (value.kind !== "primitive" && value.kind !== "element" && value.kind !== "list")
          return null;
        flushText();
        segments.push(
          element(
            { kind: "fragment" },
            objectFromRecord({ children: value }),
            primitiveValue(nextKey()),
          ),
        );
        break;
      }
      case "element": {
        const children = token.children.length
          ? renderTokens(token.children)
          : getObjectProperty(token.element.props, "children");
        if (!children) return null;
        flushText();
        segments.push(withKeyAndChildren(token.element, nextKey(), children));
        break;
      }
    }
  }
  flushText();
  if (segments.length === 0) return NULL_VALUE;
  return segments.length === 1 ? segments[0] : listValue(segments);
};

const renderSource = (source: MessageSource): StaticValue | null => {
  if (!isKnownString(source.message)) return null;
  const tokens = parseMessage(source.message.value, source);
  return tokens ? renderTokens(tokens) : null;
};

const messageSource = (
  message: StaticValue,
  id: StaticValue,
  values: StaticValue,
  components: StaticValue,
): MessageSource => ({
  message: isFalsyPrimitive(message) ? id : message,
  values: asObject(values),
  components: asObject(components),
});

const sourceFromArguments = (args: StaticValue[]): MessageSource => {
  const [idOrDescriptor = UNDEFINED_VALUE, values = UNDEFINED_VALUE, options = UNDEFINED_VALUE] =
    args;
  if (idOrDescriptor.kind === "object") {
    return messageSource(
      getObjectProperty(idOrDescriptor, "message"),
      getObjectProperty(idOrDescriptor, "id"),
      getObjectProperty(idOrDescriptor, "values"),
      getObjectProperty(idOrDescriptor, "components"),
    );
  }
  return messageSource(
    getObjectProperty(asObject(options), "message"),
    idOrDescriptor,
    values,
    UNDEFINED_VALUE,
  );
};

/** `i18n._(id | descriptor, values?, options?)`. */
const translateToString = (args: StaticValue[]): StaticValue => {
  const rendered = renderSource(sourceFromArguments(args));
  return translationBranch(
    rendered?.kind === "primitive" && typeof rendered.value === "string" ? rendered : null,
    unknownTranslatedString(),
  );
};

const noopMethod = (name: string): StaticValue => nativeFunction(name, () => UNDEFINED_VALUE);

const createI18nValue = (): StaticObjectValue =>
  objectFromRecord({
    locale: unknownPrimitiveValue("string", "active lingui locale"),
    locales: unknownValue("configured lingui locales"),
    messages: unknownValue("active lingui catalog"),
    _: nativeFunction("_", translateToString),
    t: nativeFunction("t", translateToString),
    activate: noopMethod("activate"),
    load: noopMethod("load"),
    loadAndActivate: noopMethod("loadAndActivate"),
    loadLocaleData: noopMethod("loadLocaleData"),
    setMessagesCompiler: noopMethod("setMessagesCompiler"),
    on: nativeFunction("on", () => noopMethod("removeListener")),
    removeListener: noopMethod("removeListener"),
  });

const GLOBAL_I18N = createI18nValue();

/** The `t` macro: `t\`...\``, `t(descriptor)`, or `t(i18n)\`...\``. */
const templateTag = (name: string): StaticValue =>
  nativeFunction(name, (args) => {
    const [first] = args;
    if (first?.kind === "object" && getObjectProperty(first, "_").kind === "native-function") {
      return templateTag(name);
    }
    if (first?.kind === "object") return translateToString([first]);
    const descriptor = descriptorFromTemplate(args);
    return descriptor
      ? translateToString([descriptorObject(descriptor)])
      : unknownTranslatedString();
  });

// --- @lingui/react ----------------------------------------------------------------

const RENDER_FRAGMENT_STUB: StubComponent = {
  displayName: "RenderFragment",
  render: (props) => getObjectProperty(props, "children"),
};

const TRANS_NO_CONTEXT_STUB: StubComponent = {
  displayName: "TransNoContext",
  render: (props, tools) => {
    const translation = translationBranch(
      renderSource(
        messageSource(
          getObjectProperty(props, "message"),
          getObjectProperty(props, "id"),
          getObjectProperty(props, "values"),
          getObjectProperty(props, "components"),
        ),
      ),
      unknownValue(UNKNOWN_TRANSLATION),
    );
    const render = getObjectProperty(props, "render");
    const component = getObjectProperty(props, "component");
    if (isNull(render) || isNull(component)) return translation;
    const translationProps = objectFromRecord({
      id: getObjectProperty(props, "id"),
      message: getObjectProperty(props, "message"),
      translation,
      children: translation,
    });
    if (render.kind === "function" || render.kind === "native-function") {
      return tools.call(render, [translationProps]);
    }
    if (!isUndefined(component)) return element(toElementType(component, null), translationProps);
    const defaultComponent = getObjectProperty(
      asObject(getObjectProperty(props, "lingui")),
      "defaultComponent",
    );
    return isUndefined(defaultComponent)
      ? stubElement(RENDER_FRAGMENT_STUB, { children: translation })
      : element(toElementType(defaultComponent, null), translationProps);
  },
};

const TRANS_STUB: StubComponent = {
  displayName: "Trans",
  render: (props, tools) =>
    element(
      { kind: "stub", stub: TRANS_NO_CONTEXT_STUB },
      objectValue([
        ...props.entries,
        { kind: "property", key: "lingui", value: tools.readContext(LINGUI_CONTEXT) },
      ]),
    ),
};

const I18N_PROVIDER_STUB: StubComponent = {
  displayName: "I18nProvider",
  render: (props) => {
    const i18n = getObjectProperty(props, "i18n");
    return element(
      { kind: "context-provider", context: LINGUI_CONTEXT, displayName: null },
      objectFromRecord({
        value: objectFromRecord({
          i18n,
          defaultComponent: getObjectProperty(props, "defaultComponent"),
          _: getObjectProperty(asObject(i18n), "t"),
        }),
        children: getObjectProperty(props, "children"),
      }),
    );
  },
};

const readLinguiContext = (tools: StubRenderTools): StaticValue => {
  const context = tools.readContext(LINGUI_CONTEXT);
  return isNull(context) ? unknownValue("useLingui() rendered outside an I18nProvider") : context;
};

/** `<Trans>` from the macro entry: its children are the message. */
const TRANS_MACRO_STUB: StubComponent = {
  displayName: "Trans",
  render: (props, tools) => {
    const tokens = tokenizeChildren(getObjectProperty(props, "children"));
    return TRANS_STUB.render(
      objectValue([
        ...props.entries.filter((entry) => entry.kind !== "property" || entry.key !== "children"),
        ...descriptorEntries(tokens ? describeTokens(tokens) : null),
      ]),
      tools,
    );
  },
};

/** `<Plural>`, `<Select>`, `<SelectOrdinal>`: an ICU choice message the harness does not evaluate. */
const CHOICE_MACRO_STUB: StubComponent = {
  displayName: "Trans",
  render: (props, tools) =>
    TRANS_STUB.render(
      objectValue([
        ...props.entries.filter((entry) => entry.kind === "property" && entry.key === "render"),
        ...descriptorEntries(null),
      ]),
      tools,
    ),
};

const coreValue = (importedName: string): StaticValue | null => {
  switch (importedName) {
    case "i18n":
      return GLOBAL_I18N;
    case "setupI18n":
    case "I18n":
      return nativeFunction(importedName, () => createI18nValue());
    default:
      return null;
  }
};

const coreMacroValue = (importedName: string): StaticValue | null => {
  switch (importedName) {
    case "t":
      return templateTag("t");
    case "msg":
    case "defineMessage":
      return nativeFunction(importedName, (args) =>
        args[0]?.kind === "object" ? args[0] : descriptorObject(descriptorFromTemplate(args)),
      );
    case "plural":
    case "select":
    case "selectOrdinal":
      return nativeFunction(importedName, () => unknownTranslatedString());
    default:
      return null;
  }
};

const reactValue = (importedName: string): StaticValue | null => {
  switch (importedName) {
    case "I18nProvider":
      return stubValue(I18N_PROVIDER_STUB);
    case "Trans":
      return stubValue(TRANS_STUB);
    case "TransNoContext":
      return stubValue(TRANS_NO_CONTEXT_STUB);
    case "useLingui":
      return nativeFunction(importedName, (_args, tools) => readLinguiContext(tools));
    default:
      return null;
  }
};

const reactMacroValue = (importedName: string): StaticValue | null => {
  switch (importedName) {
    case "Trans":
      return stubValue(TRANS_MACRO_STUB);
    case "Plural":
    case "Select":
    case "SelectOrdinal":
      return stubValue(CHOICE_MACRO_STUB);
    case "useLingui":
      return nativeFunction(importedName, (_args, tools) => {
        const context = readLinguiContext(tools);
        return context.kind === "object"
          ? objectValue([
              ...context.entries,
              { kind: "property", key: "t", value: templateTag("t") },
            ])
          : context;
      });
    default:
      return null;
  }
};

export const linguiValue: ExternalValueProvider = (specifier, importedName) => {
  switch (specifier) {
    case "@lingui/core":
      return coreValue(importedName);
    case "@lingui/core/macro":
      return coreMacroValue(importedName);
    case "@lingui/react":
      return reactValue(importedName);
    case "@lingui/react/macro":
      return reactMacroValue(importedName);
    default:
      return null;
  }
};
