import { createHash } from "node:crypto";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  isKnownString,
  isUndefinedValue,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { element, nativeFunction, stubElement, stubValue } from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import { isVersionAtLeast } from "./installed-version.js";
import type {
  CapturedLinguiCatalog,
  CapturedValue,
  ContextDefinition,
  LibraryValueProvider,
  MacroJsxChild,
  ProjectContext,
  StaticElementValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";

// Static stand-in for Lingui (@lingui/core, @lingui/react and their `/macro`
// entry points). The macros are a build-time transform: `<Trans>Hi {name}</Trans>`
// becomes `<Trans id message="Hi {name}" values={{name}} />`, and at runtime
// `TransNoContext` looks the id up in the active catalog, interpolates the values
// and rebuilds `<0>..</0>` tags from `components` (`formatElements`). When the
// page's catalog was captured, translation is exact; otherwise it is a branch
// between what the source message renders to (a source-locale catalog, or
// Lingui's own fallback for a missing entry) and an unknown translated string.

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
  /** The identifier the macro names the placeholder after; null for positional placeholders. */
  name: string | null;
  value: StaticValue;
}

interface MessageElementToken {
  kind: "element";
  element: StaticElementValue;
  children: MessageToken[];
}

type MessageToken = MessageTextToken | MessageArgumentToken | MessageElementToken;

/** The `{id, message, values, components}` a macro expands a message to. */
interface MessageDescriptor {
  id: string;
  message: string;
  values: Record<string, StaticValue>;
  components: Record<string, StaticValue>;
}

/** What `TransNoContext` / `i18n._` receive, as props or arguments. */
interface MessageSource {
  id: StaticValue;
  message: StaticValue;
  values: StaticObjectValue;
  components: StaticObjectValue;
}

interface PlaceholderCounters {
  nextArgument: () => number;
  nextElement: () => number;
}

interface LinguiModel {
  getValue: (specifier: string, importedName: string) => StaticValue | null;
}

const UNKNOWN_TRANSLATION = "translation comes from the runtime message catalog";
const UNIT_SEPARATOR = "\u001F";

const isNull = (value: StaticValue): boolean => value.kind === "primitive" && value.value === null;

const isFalsyPrimitive = (value: StaticValue): boolean =>
  value.kind === "primitive" && !value.value;

const asObject = (value: StaticValue): StaticObjectValue =>
  value.kind === "object" ? value : objectValue();

const unknownTranslatedString = (): StaticValue =>
  unknownPrimitiveValue("string", UNKNOWN_TRANSLATION);

const makeCounter = (): (() => number) => {
  let index = 0;
  return () => index++;
};

/** `@lingui/message-utils` `generateMessageId`. */
const generateMessageId = (message: string, context: string): string =>
  createHash("sha256").update(`${message}${UNIT_SEPARATOR}${context}`).digest("base64").slice(0, 6);

// --- macro side: children / template literal -> descriptor -------------------

const tokenizeMacroChildren = (children: MacroJsxChild[]): MessageToken[] | null => {
  const tokens: MessageToken[] = [];
  for (const { value, source } of children) {
    switch (source.kind) {
      case "text":
        if (!isKnownString(value)) return null;
        tokens.push({ kind: "text", text: value.value });
        break;
      case "identifier":
        tokens.push({ kind: "argument", name: source.name, value });
        break;
      case "expression":
        tokens.push({ kind: "argument", name: null, value });
        break;
      case "element": {
        const nested = source.children && tokenizeMacroChildren(source.children);
        if (!nested || value.kind !== "element") return null;
        tokens.push({ kind: "element", element: value, children: nested });
        break;
      }
    }
  }
  return tokens;
};

const serializeTokens = (
  tokens: MessageToken[],
  descriptor: MessageDescriptor,
  counters: PlaceholderCounters,
): string =>
  tokens
    .map((token) => {
      switch (token.kind) {
        case "text":
          return token.text;
        case "argument": {
          const name = token.name ?? String(counters.nextArgument());
          descriptor.values[name] = token.value;
          return `{${name}}`;
        }
        case "element": {
          const name = String(counters.nextElement());
          descriptor.components[name] = token.element;
          return token.children.length
            ? `<${name}>${serializeTokens(token.children, descriptor, counters)}</${name}>`
            : `<${name}/>`;
        }
      }
    })
    .join("");

const describeTokens = (tokens: MessageToken[], context: StaticValue): MessageDescriptor => {
  const descriptor: MessageDescriptor = { id: "", message: "", values: {}, components: {} };
  descriptor.message = serializeTokens(tokens, descriptor, {
    nextArgument: makeCounter(),
    nextElement: makeCounter(),
  });
  descriptor.id = generateMessageId(
    descriptor.message,
    isKnownString(context) ? context.value : "",
  );
  return descriptor;
};

const templateTokens = (
  strings: StaticValue,
  values: StaticValue[],
  names: Array<string | null>,
): MessageToken[] | null => {
  if (strings.kind !== "list") return null;
  const tokens: MessageToken[] = [];
  for (const [index, quasi] of strings.items.entries()) {
    if (!isKnownString(quasi)) return null;
    tokens.push({ kind: "text", text: quasi.value });
    if (index < values.length) {
      tokens.push({ kind: "argument", name: names[index] ?? null, value: values[index] });
    }
  }
  return tokens;
};

const descriptorFromTemplate = (
  args: StaticValue[],
  tools: StubRenderTools,
): MessageDescriptor | null => {
  const [strings, ...values] = args;
  const tokens = strings
    ? templateTokens(strings, values, tools.templateArgumentNames ?? [])
    : null;
  return tokens ? describeTokens(tokens, UNDEFINED_VALUE) : null;
};

const descriptorEntries = (descriptor: MessageDescriptor | null): StaticObjectEntry[] =>
  Object.entries({
    id: descriptor
      ? primitiveValue(descriptor.id)
      : unknownPrimitiveValue("string", "lingui message id is a hash of the message"),
    message: descriptor ? primitiveValue(descriptor.message) : unknownTranslatedString(),
    values: objectFromRecord(descriptor?.values ?? {}),
    components: objectFromRecord(descriptor?.components ?? {}),
  }).map(([key, value]) => ({ kind: "property", key, value }));

const descriptorObject = (descriptor: MessageDescriptor | null): StaticObjectValue =>
  objectValue(descriptorEntries(descriptor));

/** `msg({ message, context })` without an id: the macro adds the id it hashes from them. */
const withGeneratedId = (descriptor: StaticObjectValue): StaticObjectValue => {
  const message = getObjectProperty(descriptor, "message");
  if (!isUndefinedValue(getObjectProperty(descriptor, "id")) || !isKnownString(message)) {
    return descriptor;
  }
  const context = getObjectProperty(descriptor, "context");
  const id = generateMessageId(message.value, isKnownString(context) ? context.value : "");
  return objectValue([
    { kind: "property", key: "id", value: primitiveValue(id) },
    ...descriptor.entries,
  ]);
};

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
      tokens.push({
        kind: "argument",
        name: argumentName,
        value: getObjectProperty(source.values, argumentName),
      });
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

const renderMessage = (message: string, source: MessageSource): StaticValue | null => {
  const tokens = parseMessage(message, source);
  return tokens ? renderTokens(tokens) : null;
};

/**
 * A compiled catalog entry (`@lingui/message-utils` `compileMessage`) back as
 * the message `interpolate` reads: literal text and `[name]` placeholders.
 * Null for formatted, plural and select arguments, which the model does not evaluate.
 */
const compiledMessageText = (compiled: CapturedValue): string | null => {
  if (typeof compiled === "string") return compiled;
  if (!Array.isArray(compiled)) return null;
  let text = "";
  for (const token of compiled) {
    if (typeof token === "string") {
      text += token;
    } else if (Array.isArray(token) && token.length === 1 && typeof token[0] === "string") {
      text += `{${token[0]}}`;
    } else {
      return null;
    }
  }
  return text;
};

const messageSource = (
  id: StaticValue,
  message: StaticValue,
  values: StaticValue,
  components: StaticValue,
): MessageSource => ({
  id,
  message,
  values: asObject(values),
  components: asObject(components),
});

const sourceFromArguments = (args: StaticValue[]): MessageSource => {
  const [idOrDescriptor = UNDEFINED_VALUE, values = UNDEFINED_VALUE, options = UNDEFINED_VALUE] =
    args;
  if (idOrDescriptor.kind === "object") {
    return messageSource(
      getObjectProperty(idOrDescriptor, "id"),
      getObjectProperty(idOrDescriptor, "message"),
      getObjectProperty(idOrDescriptor, "values"),
      getObjectProperty(idOrDescriptor, "components"),
    );
  }
  return messageSource(
    idOrDescriptor,
    getObjectProperty(asObject(options), "message"),
    values,
    UNDEFINED_VALUE,
  );
};

const noopMethod = (name: string): StaticValue => nativeFunction(name, () => UNDEFINED_VALUE);

/** `@lingui/react` renamed `TransNoContext`'s fallback `RenderFragment` to `RenderChildren` in 5.9.0. */
const RENDER_CHILDREN_VERSION = "5.9.0";

const createFallbackComponentStub = (version: string | null): StubComponent => ({
  displayName:
    version !== null && isVersionAtLeast(version, RENDER_CHILDREN_VERSION)
      ? "RenderChildren"
      : "RenderFragment",
  render: (props) => getObjectProperty(props, "children"),
});

const readLinguiContext = (tools: StubRenderTools): StaticValue => {
  const context = tools.readContext(LINGUI_CONTEXT);
  return isNull(context) ? unknownValue("useLingui() rendered outside an I18nProvider") : context;
};

const createLinguiModel = (
  catalog: CapturedLinguiCatalog | null,
  fallbackComponentStub: StubComponent,
): LinguiModel => {
  /**
   * `i18n._`: `messages[id] || message || id`, rendered. Exact against a captured
   * catalog; a branch against the unknown runtime catalog otherwise.
   */
  const translation = (source: MessageSource, unknown: StaticValue): StaticValue => {
    const fallback = isFalsyPrimitive(source.message) ? source.id : source.message;
    const renderFallback = (): StaticValue | null =>
      isKnownString(fallback) ? renderMessage(fallback.value, source) : null;
    if (!catalog || !isKnownString(source.id)) {
      const rendered = renderFallback();
      return rendered
        ? branchValue([rendered, unknown], "lingui catalog may translate the message")
        : unknown;
    }
    const compiled = catalog.messages[source.id.value];
    if (compiled === undefined || compiled === "") return renderFallback() ?? unknown;
    const message = compiledMessageText(compiled);
    return (message === null ? null : renderMessage(message, source)) ?? unknown;
  };

  const translateToString = (args: StaticValue[]): StaticValue =>
    translation(sourceFromArguments(args), unknownTranslatedString());

  const createI18nValue = (): StaticObjectValue =>
    objectFromRecord({
      locale: catalog
        ? primitiveValue(catalog.locale)
        : unknownPrimitiveValue("string", "active lingui locale"),
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

  const globalI18n = createI18nValue();

  /** The `t` macro: `t\`...\``, `t(descriptor)`, or `t(i18n)\`...\``. */
  const templateTag = (name: string): StaticValue =>
    nativeFunction(name, (args, tools) => {
      const [first] = args;
      if (first?.kind === "object" && getObjectProperty(first, "_").kind === "native-function") {
        return templateTag(name);
      }
      if (first?.kind === "object") return translateToString([withGeneratedId(first)]);
      const descriptor = descriptorFromTemplate(args, tools);
      return descriptor
        ? translateToString([descriptorObject(descriptor)])
        : unknownTranslatedString();
    });

  const transNoContextStub: StubComponent = {
    displayName: "TransNoContext",
    render: (props, tools) => {
      const translated = translation(
        messageSource(
          getObjectProperty(props, "id"),
          getObjectProperty(props, "message"),
          getObjectProperty(props, "values"),
          getObjectProperty(props, "components"),
        ),
        unknownValue(UNKNOWN_TRANSLATION),
      );
      const render = getObjectProperty(props, "render");
      const component = getObjectProperty(props, "component");
      if (isNull(render) || isNull(component)) return translated;
      const translationProps = objectFromRecord({
        id: getObjectProperty(props, "id"),
        message: getObjectProperty(props, "message"),
        translation: translated,
        children: translated,
      });
      if (render.kind === "function" || render.kind === "native-function") {
        return tools.call(render, [translationProps]);
      }
      if (!isUndefinedValue(component)) {
        return element(toElementType(component, null), translationProps);
      }
      const defaultComponent = getObjectProperty(
        asObject(getObjectProperty(props, "lingui")),
        "defaultComponent",
      );
      return isUndefinedValue(defaultComponent)
        ? stubElement(fallbackComponentStub, { children: translated })
        : element(toElementType(defaultComponent, null), translationProps);
    },
  };

  const transStub: StubComponent = {
    displayName: "Trans",
    render: (props, tools) =>
      element(
        { kind: "stub", stub: transNoContextStub },
        objectValue([
          ...props.entries,
          { kind: "property", key: "lingui", value: tools.readContext(LINGUI_CONTEXT) },
        ]),
      ),
  };

  const i18nProviderStub: StubComponent = {
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

  const withoutChildren = (props: StaticObjectValue): StaticObjectEntry[] =>
    props.entries.filter((entry) => entry.kind !== "property" || entry.key !== "children");

  /** `<Trans>` from the macro entry: its children are the message. */
  const transMacroStub: StubComponent = {
    displayName: "Trans",
    render: transStub.render,
    expandJsx: (props, children) => {
      const tokens = tokenizeMacroChildren(children);
      const context = getObjectProperty(props, "context");
      return objectValue([
        ...withoutChildren(props),
        ...descriptorEntries(tokens ? describeTokens(tokens, context) : null),
      ]);
    },
  };

  /** `<Plural>`, `<Select>`, `<SelectOrdinal>`: an ICU choice message the harness does not evaluate. */
  const choiceMacroStub: StubComponent = {
    displayName: "Trans",
    render: transStub.render,
    expandJsx: (props) =>
      objectValue([
        ...props.entries.filter((entry) => entry.kind === "property" && entry.key === "render"),
        ...descriptorEntries(null),
      ]),
  };

  const coreValue = (importedName: string): StaticValue | null => {
    switch (importedName) {
      case "i18n":
        return globalI18n;
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
        return nativeFunction(importedName, (args, tools) =>
          args[0]?.kind === "object"
            ? withGeneratedId(args[0])
            : descriptorObject(descriptorFromTemplate(args, tools)),
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
        return stubValue(i18nProviderStub);
      case "Trans":
        return stubValue(transStub);
      case "TransNoContext":
        return stubValue(transNoContextStub);
      case "useLingui":
        return nativeFunction(importedName, (_args, tools) => readLinguiContext(tools));
      default:
        return null;
    }
  };

  const reactMacroValue = (importedName: string): StaticValue | null => {
    switch (importedName) {
      case "Trans":
        return stubValue(transMacroStub);
      case "Plural":
      case "Select":
      case "SelectOrdinal":
        return stubValue(choiceMacroStub);
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

  return {
    getValue: (specifier, importedName) => {
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
    },
  };
};

const models = new WeakMap<ProjectContext, LinguiModel>();

export const linguiValue: LibraryValueProvider = (specifier, importedName, project) => {
  let model = models.get(project);
  if (!model) {
    model = createLinguiModel(
      project.linguiCatalog,
      createFallbackComponentStub(project.readPackageVersion("@lingui/react")),
    );
    models.set(project, model);
  }
  return model.getValue(specifier, importedName);
};
