import {
  FALSE_VALUE,
  UNDEFINED_VALUE,
  getListItem,
  getObjectProperty,
  isNullish,
  objectFromRecord,
  primitiveValue,
} from "../evaluate/values.js";
import { lazyProperties, nativeFunction, noopFunction, stubValue } from "../evaluate/stubs.js";
import type {
  ExternalValueProvider,
  StaticObjectValue,
  StaticReactApiValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

// MobX observability is transparent to a render: annotations (`makeObservable`,
// `observable`, `action`, `computed`) leave the annotated values in place and
// only track reads for later invalidation, so the static side keeps the plain
// values. `observer` is `memo(component)` whose inner render is the component
// itself (`useObserver` runs it inside a reaction); class components are
// patched in place and keep their identity.

export const MOBX_PACKAGES = ["mobx", "mobx-react", "mobx-react-lite"];

const MEMO: StaticReactApiValue = { kind: "react-api", api: "memo" };
const USE_STATE: StaticReactApiValue = { kind: "react-api", api: "useState" };

const identity = (name: string): StaticValue =>
  nativeFunction(name, ([first]) => first ?? UNDEFINED_VALUE);

const callFirst = (name: string): StaticValue =>
  nativeFunction(name, ([first], tools) => (first ? tools.call(first, []) : UNDEFINED_VALUE));

const isStringValue = (value: StaticValue | undefined): boolean =>
  value?.kind === "primitive" && typeof value.value === "string";

/** `annotate(x)` is `x`, `action("name", fn)` is `fn`; `annotate.variant` is the same annotation. */
const annotation = (name: string): StaticValue =>
  lazyProperties(
    nativeFunction(name, ([first, second]) =>
      isStringValue(first) && second ? second : (first ?? UNDEFINED_VALUE),
    ),
    (variant) => primitiveValue(`${name}.${variant}`),
  );

const computed = (): StaticValue =>
  nativeFunction("computed", ([derive], tools) =>
    derive?.kind === "function" || derive?.kind === "native-function"
      ? objectFromRecord({ get: nativeFunction("get", () => tools.call(derive, [])) })
      : (derive ?? UNDEFINED_VALUE),
  );

const disposer = (): StaticValue => noopFunction("dispose");

const reaction = (): StaticValue =>
  nativeFunction("reaction", ([expression, effect, options], tools) => {
    if (!expression) return disposer();
    const value = tools.call(expression, []);
    const fireImmediately =
      options?.kind === "object" ? getObjectProperty(options, "fireImmediately") : UNDEFINED_VALUE;
    if (effect && fireImmediately.kind === "primitive" && fireImmediately.value === true) {
      tools.call(effect, [value, UNDEFINED_VALUE]);
    }
    return disposer();
  });

const autorun = (): StaticValue =>
  nativeFunction("autorun", ([effect], tools) => {
    if (effect) tools.call(effect, []);
    return disposer();
  });

const observer = (): StaticValue =>
  nativeFunction("observer", ([component], tools) => {
    if (!component) return UNDEFINED_VALUE;
    if (component.kind === "class") return component;
    if (component.kind === "component-reference" && component.type.kind === "memo")
      return component;
    return tools.call(MEMO, [component]);
  });

const renderObserved = (props: StaticObjectValue, tools: StubRenderTools): StaticValue => {
  const children = getObjectProperty(props, "children");
  const render = isNullish(children) === false ? children : getObjectProperty(props, "render");
  return isNullish(render) === false ? tools.call(render, []) : UNDEFINED_VALUE;
};

const useLocalObservable = (name: string): StaticValue =>
  nativeFunction(name, ([initializer], tools) => {
    const state = tools.call(USE_STATE, initializer ? [initializer] : []);
    return state.kind === "list" ? getListItem(state.items, 0, null) : state;
  });

const getMobxExport = (importedName: string): StaticValue | null => {
  switch (importedName) {
    case "makeObservable":
    case "makeAutoObservable":
    case "toJS":
      return identity(importedName);
    case "observable":
    case "action":
      return annotation(importedName);
    case "computed":
      return computed();
    case "runInAction":
      return callFirst(importedName);
    case "reaction":
      return reaction();
    case "autorun":
      return autorun();
    case "configure":
      return noopFunction(importedName);
    default:
      return null;
  }
};

const getMobxReactExport = (importedName: string): StaticValue | null => {
  switch (importedName) {
    case "observer":
      return observer();
    case "Observer":
      return stubValue({ displayName: "Observer", render: renderObserved });
    case "useObserver":
      return callFirst(importedName);
    case "useLocalObservable":
    case "useLocalStore":
      return useLocalObservable(importedName);
    case "useAsObservableSource":
      return identity(importedName);
    case "enableStaticRendering":
    case "useStaticRendering":
    case "observerBatching":
      return noopFunction(importedName);
    case "isUsingStaticRendering":
      return nativeFunction(importedName, () => FALSE_VALUE);
    default:
      return null;
  }
};

export const mobxValue: ExternalValueProvider = (specifier, importedName) => {
  switch (specifier) {
    case "mobx":
      return getMobxExport(importedName);
    case "mobx-react":
    case "mobx-react-lite":
      return getMobxReactExport(importedName);
    default:
      return null;
  }
};
