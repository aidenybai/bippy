import {
  branchValue,
  FALSE_VALUE,
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  isUndefinedValue,
  listValue,
  mapValue,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import {
  element,
  lazyProperties,
  nativeFunction,
  noopFunction,
  passthroughStub,
  stubValue,
} from "../evaluate/stubs.js";
import type {
  CapturedValue,
  ContextDefinition,
  LibraryValueProvider,
  ProjectContext,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";

// Kea's core is modeled; its plugins (kea-loaders, kea-forms, kea-router, ...)
// are ordinary logic builders written against this core and are analyzed from
// their shipped source. A logic's reducer values live in the Redux store under
// the logic's path, so when the page's store was captured a reducer reads as
// the value the page settled on, and selectors are recomputed from those
// values with the logic's own combiners. Without a capture a reducer is either
// its default or whatever listeners and loaders changed it to after mount.

export const KEA_PACKAGES = ["kea"];

interface KeaWrapper {
  inputs: StaticValue[];
  builds: Map<string, KeaLogicBuild>;
  /** `BindLogic`'s per-logic React context (`getOrCreateContextForLogicWrapper`). */
  context: ContextDefinition;
  project: ProjectContext;
  value: StaticValue;
}

interface KeaLogicBuild {
  wrapper: KeaWrapper;
  /** Segments as written; null while the path is kea's automatic one. */
  path: StaticValue[] | null;
  key: StaticValue | null;
  props: Record<string, StaticValue>;
  defaults: Map<string, StaticValue>;
  /** `defaults((logic) => (state, props) => values)`: the root default selector. */
  starDefault: StaticValue | null;
  selectors: Map<string, () => StaticValue>;
  actions: Map<string, StaticValue>;
  /** Why values this logic may define could not be enumerated (a spread of unknown reducers). */
  uncertainty: string | null;
  cache: StaticObjectValue;
  tools: StubRenderTools;
  value: StaticValue;
}

interface KeaBuilder {
  (build: KeaLogicBuild, tools: StubRenderTools): void;
}

const WRAPPERS = new WeakMap<StaticValue, KeaWrapper>();
const BUILDS = new WeakMap<StaticValue, KeaLogicBuild>();
const BUILDERS = new WeakMap<StaticValue, KeaBuilder>();

const STORE_STATE = unknownValue("the Redux store state");

const isCallable = (value: StaticValue): boolean =>
  value.kind === "function" || value.kind === "native-function" || value.kind === "proxy";

const pathSegment = (segment: StaticValue): string | null =>
  segment.kind === "primitive" &&
  (typeof segment.value === "string" || typeof segment.value === "number")
    ? String(segment.value)
    : null;

const describePath = (build: KeaLogicBuild): string =>
  build.path ? build.path.map((segment) => pathSegment(segment) ?? "?").join(".") : "kea.logic";

const readCapturedPath = (
  state: CapturedValue,
  storePath: readonly string[],
): CapturedValue | undefined => {
  let current: CapturedValue | undefined = state;
  for (const segment of storePath) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[segment];
  }
  return current;
};

/** The value at `path` in the first recorded store holding it; `undefined` when none does. */
const findStoreValue = (
  states: readonly CapturedValue[],
  storePath: readonly string[],
): CapturedValue | undefined => {
  for (const state of states) {
    const value = readCapturedPath(state, storePath);
    if (value !== undefined) return value;
  }
  return undefined;
};

/**
 * Where the logic's reducers live in the store. A keyed logic whose key is not
 * known statically still maps to the store when a single instance was mounted.
 */
const storePath = (build: KeaLogicBuild, states: readonly CapturedValue[]): string[] | null => {
  if (!build.path) return null;
  const segments = build.path.map(pathSegment);
  const known = segments.filter((segment): segment is string => segment !== null);
  if (known.length === segments.length) return known;
  if (known.length !== segments.length - 1 || segments[segments.length - 1] !== null) return null;
  const parent = findStoreValue(states, known);
  if (
    parent === null ||
    parent === undefined ||
    typeof parent !== "object" ||
    Array.isArray(parent)
  )
    return null;
  const instances = Object.keys(parent);
  return instances.length === 1 ? [...known, instances[0]] : null;
};

type StoreLookup =
  | { kind: "unobserved" }
  | { kind: "absent" }
  | { kind: "found"; value: CapturedValue };

const lookupStore = (build: KeaLogicBuild, key: string | null): StoreLookup => {
  const states = build.wrapper.project.storeStates;
  if (!states) return { kind: "unobserved" };
  const path = storePath(build, states);
  if (!path) return { kind: "unobserved" };
  const value = findStoreValue(states, key === null ? path : [...path, key]);
  return value === undefined ? { kind: "absent" } : { kind: "found", value };
};

const readStored = (
  build: KeaLogicBuild,
  key: string,
  defaultValue: StaticValue,
  tools: StubRenderTools,
): StaticValue => {
  const description = `kea value ${describePath(build)}.${key}`;
  const lookup = lookupStore(build, key);
  switch (lookup.kind) {
    case "unobserved":
      return branchValue(
        [defaultValue, unknownValue(`${description} after the logic mounted`)],
        `${description} at runtime`,
      );
    case "absent":
      return defaultValue;
    case "found":
      return tools.captured(lookup.value, description);
  }
};

const memoized = (compute: () => StaticValue, description: string): (() => StaticValue) => {
  let result: StaticValue | null = null;
  let isComputing = false;
  return () => {
    if (result) return result;
    if (isComputing) return unknownValue(`${description} depends on itself`);
    isComputing = true;
    try {
      result = compute();
    } finally {
      isComputing = false;
    }
    return result;
  };
};

const readValue = (build: KeaLogicBuild, key: string): StaticValue => {
  const selector = build.selectors.get(key);
  if (selector) return selector();
  return build.uncertainty
    ? unknownValue(`kea value ${describePath(build)}.${key}: ${build.uncertainty}`)
    : UNDEFINED_VALUE;
};

const propsValue = (build: KeaLogicBuild): StaticObjectValue => objectFromRecord(build.props);

const valuesValue = (build: KeaLogicBuild): StaticValue =>
  lazyProperties(objectValue(), (key) => readValue(build, key));

const selectorsValue = (build: KeaLogicBuild): StaticValue =>
  lazyProperties(objectValue(), (key) =>
    build.selectors.has(key)
      ? nativeFunction(`${describePath(build)}.selectors.${key}`, () => readValue(build, key))
      : UNDEFINED_VALUE,
  );

const propSelectorsValue = (build: KeaLogicBuild): StaticValue =>
  lazyProperties(objectValue(), (key) =>
    nativeFunction(`props.${key}`, () => build.props[key] ?? UNDEFINED_VALUE),
  );

const actionsValue = (build: KeaLogicBuild): StaticValue =>
  lazyProperties(objectValue(), (key) => build.actions.get(key) ?? UNDEFINED_VALUE);

const asyncActionsValue = (build: KeaLogicBuild): StaticValue =>
  lazyProperties(objectValue(), (key) =>
    build.actions.has(key)
      ? nativeFunction(key, () => unknownValue(`promise of kea action ${key}`))
      : UNDEFINED_VALUE,
  );

const actionType = (key: string, build: KeaLogicBuild): string =>
  `${key
    .replace(/(?:^|\.?)([A-Z])/g, (_match, letter: string) => ` ${letter.toLowerCase()}`)
    .replace(/^ /, "")} (${describePath(build)})`;

const actionCreatorsValue = (build: KeaLogicBuild): StaticValue =>
  lazyProperties(objectValue(), (key) =>
    build.actions.has(key)
      ? nativeFunction(key, () =>
          objectFromRecord({
            type: primitiveValue(actionType(key, build)),
            payload: unknownValue(`payload of kea action ${key}`),
          }),
        )
      : UNDEFINED_VALUE,
  );

const actionTypesValue = (build: KeaLogicBuild): StaticValue =>
  lazyProperties(objectValue(), (key) =>
    build.actions.has(key) ? primitiveValue(actionType(key, build)) : UNDEFINED_VALUE,
  );

const defaultsValue = (build: KeaLogicBuild): StaticValue =>
  lazyProperties(objectValue(), (key) => build.defaults.get(key) ?? UNDEFINED_VALUE);

const isMountedValue = (build: KeaLogicBuild): StaticValue => {
  switch (lookupStore(build, null).kind) {
    case "unobserved":
      return branchValue(
        [TRUE_VALUE, FALSE_VALUE],
        `whether kea logic ${describePath(build)} is mounted`,
      );
    case "absent":
      return FALSE_VALUE;
    case "found":
      return TRUE_VALUE;
  }
};

const builtLogicProperty = (build: KeaLogicBuild, key: string): StaticValue => {
  switch (key) {
    case "_isKeaBuild":
      return TRUE_VALUE;
    case "path":
      return build.path ? listValue(build.path) : listValue([]);
    case "pathString":
      return primitiveValue(describePath(build));
    case "key":
      return build.key ?? UNDEFINED_VALUE;
    case "props":
      return propsValue(build);
    case "values":
      return valuesValue(build);
    case "selectors":
      return selectorsValue(build);
    case "actions":
      return actionsValue(build);
    case "asyncActions":
      return asyncActionsValue(build);
    case "actionCreators":
      return actionCreatorsValue(build);
    case "actionTypes":
      return actionTypesValue(build);
    case "defaults":
      return defaultsValue(build);
    case "reducers":
      return lazyProperties(objectValue(), (reducerKey) =>
        build.selectors.has(reducerKey) ? noopFunction(reducerKey) : UNDEFINED_VALUE,
      );
    case "cache":
      return build.cache;
    case "wrapper":
      return build.wrapper.value;
    case "mount":
      return nativeFunction("mount", () => noopFunction("unmount"));
    case "unmount":
      return noopFunction("unmount");
    case "isMounted":
      return nativeFunction("isMounted", () => isMountedValue(build));
    case "extend":
      return nativeFunction("extend", ([input], tools) => {
        if (input) applyInput(build, input, tools);
        return build.value;
      });
    case "connections":
    case "events":
    case "listeners":
    case "sharedListeners":
    case "reducerOptions":
      return objectValue();
    default:
      return UNDEFINED_VALUE;
  }
};

const resolveInput = (
  input: StaticValue,
  build: KeaLogicBuild,
  tools: StubRenderTools,
): StaticValue => (isCallable(input) ? tools.call(input, [build.value]) : input);

const knownEntries = (value: StaticValue): Array<[string, StaticValue]> | null => {
  if (value.kind !== "object") return null;
  const keys = getKnownObjectKeys(value);
  return keys?.map((key) => [key, getObjectProperty(value, key)]) ?? null;
};

const markUncertain = (build: KeaLogicBuild, reason: string): void => {
  build.uncertainty ??= reason;
};

const applyPath: (input: StaticValue) => KeaBuilder = (input) => (build, tools) => {
  if (build.path) return;
  const resolved = isCallable(input) ? tools.call(input, [build.key ?? UNDEFINED_VALUE]) : input;
  if (!hasDefiniteItems(resolved)) return;
  const segments = resolved.items.filter((segment) => !isUndefinedValue(segment));
  build.path = build.key && !isCallable(input) ? [...segments, build.key] : segments;
};

const applyKey: (input: StaticValue) => KeaBuilder = (input) => (build, tools) => {
  if (build.key) return;
  build.key = tools.call(input, [propsValue(build)]);
  if (build.path) build.path = [...build.path, build.key];
};

const applyProps: (input: StaticValue) => KeaBuilder = (input) => (build) => {
  for (const [key, value] of knownEntries(input) ?? []) build.props[key] ??= value;
};

const applyDefaults: (input: StaticValue) => KeaBuilder = (input) => (build, tools) => {
  const resolved = resolveInput(input, build, tools);
  if (isCallable(resolved)) {
    build.starDefault = resolved;
    return;
  }
  for (const [key, value] of knownEntries(resolved) ?? []) build.defaults.set(key, value);
};

const applyActions: (input: StaticValue) => KeaBuilder = (input) => (build, tools) => {
  const entries = knownEntries(resolveInput(input, build, tools));
  if (!entries) return markUncertain(build, `kea actions of ${describePath(build)}`);
  for (const [key] of entries) build.actions.set(key, noopFunction(key));
};

const defaultOf = (
  build: KeaLogicBuild,
  key: string,
  initialValue: StaticValue,
  tools: StubRenderTools,
): StaticValue => {
  const declared = build.defaults.get(key);
  if (declared) return declared;
  if (build.starDefault) {
    const fromStar = getObjectProperty(
      objectValue([
        { kind: "spread", value: tools.call(build.starDefault, [STORE_STATE, propsValue(build)]) },
      ]),
      key,
    );
    return isUndefinedValue(fromStar) ? initialValue : fromStar;
  }
  return initialValue;
};

const applyReducers: (input: StaticValue) => KeaBuilder = (input) => (build, tools) => {
  const entries = knownEntries(resolveInput(input, build, tools));
  if (!entries) return markUncertain(build, `kea reducers of ${describePath(build)}`);
  for (const [key, definition] of entries) {
    const initialValue =
      definition.kind === "list" && definition.items.length > 0 ? definition.items[0] : NULL_VALUE;
    const defaultValue = defaultOf(
      build,
      key,
      isUndefinedValue(initialValue) ? NULL_VALUE : initialValue,
      tools,
    );
    build.defaults.set(key, defaultValue);
    if (!build.selectors.has(key)) {
      build.selectors.set(
        key,
        memoized(() => {
          const settled = isCallable(defaultValue)
            ? tools.call(defaultValue, [STORE_STATE, propsValue(build)])
            : defaultValue;
          return readStored(build, key, settled, tools);
        }, key),
      );
    }
  }
};

const applySelectors: (input: StaticValue) => KeaBuilder = (input) => (build, tools) => {
  const entries = knownEntries(resolveInput(input, build, tools));
  if (!entries) return markUncertain(build, `kea selectors of ${describePath(build)}`);
  for (const [key, definition] of entries) {
    const description = `kea selector ${describePath(build)}.${key}`;
    if (!hasDefiniteItems(definition) || definition.items.length < 2) {
      build.selectors.set(key, () => unknownValue(`${description} has an unknown definition`));
      continue;
    }
    const [inputSelectors, combiner] = definition.items;
    build.selectors.set(
      key,
      memoized(() => {
        const inputs = tools.call(inputSelectors, [
          selectorsValue(build),
          propSelectorsValue(build),
        ]);
        if (!hasDefiniteItems(inputs)) return unknownValue(`inputs of ${description}`);
        const args = inputs.items.map((selector) =>
          tools.call(selector, [STORE_STATE, propsValue(build)]),
        );
        return tools.call(combiner, args);
      }, description),
    );
  }
};

/** `[logic, ['a', 'b as c'], other, ['d']]` as `[logic, from, to][]`. */
const connectMapping = (mapping: StaticValue): Array<[StaticValue, string, string]> | null => {
  if (!hasDefiniteItems(mapping) || mapping.items.length % 2 === 1) return null;
  const pairs: Array<[StaticValue, string, string]> = [];
  for (let index = 0; index < mapping.items.length; index += 2) {
    const source = mapping.items[index];
    const names = mapping.items[index + 1];
    if (!hasDefiniteItems(names)) return null;
    for (const name of names.items) {
      if (name.kind !== "primitive" || typeof name.value !== "string") return null;
      const [from, to] = name.value.includes(" as ")
        ? name.value.split(" as ")
        : [name.value, name.value];
      pairs.push([source, from, to]);
    }
  }
  return pairs;
};

const resolveConnected = (
  source: StaticValue,
  build: KeaLogicBuild,
  tools: StubRenderTools,
): KeaLogicBuild | null => {
  const wrapper = WRAPPERS.get(source);
  if (wrapper) return buildLogic(wrapper, propsValue(build), tools);
  return BUILDS.get(source) ?? null;
};

const applyConnect: (input: StaticValue) => KeaBuilder = (input) => (build, tools) => {
  const resolved =
    isCallable(input) && !WRAPPERS.has(input) ? tools.call(input, [propsValue(build)]) : input;
  if (WRAPPERS.has(resolved) || BUILDS.has(resolved) || resolved.kind === "list") {
    for (const source of resolved.kind === "list" ? resolved.items : [resolved]) {
      resolveConnected(source, build, tools);
    }
    return;
  }
  if (resolved.kind !== "object")
    return markUncertain(build, `kea connect of ${describePath(build)}`);
  const connectedLogic = getObjectProperty(resolved, "logic");
  if (hasDefiniteItems(connectedLogic)) {
    for (const source of connectedLogic.items) resolveConnected(source, build, tools);
  }
  const actions = getObjectProperty(resolved, "actions");
  if (!isUndefinedValue(actions)) {
    const pairs = connectMapping(actions);
    if (!pairs) return markUncertain(build, `kea connected actions of ${describePath(build)}`);
    for (const [source, from, to] of pairs) {
      const other = resolveConnected(source, build, tools);
      build.actions.set(to, other?.actions.get(from) ?? noopFunction(to));
    }
  }
  const values = getObjectProperty(resolved, "values");
  if (!isUndefinedValue(values)) {
    const pairs = connectMapping(values);
    if (!pairs) return markUncertain(build, `kea connected values of ${describePath(build)}`);
    for (const [source, from, to] of pairs) {
      const other = resolveConnected(source, build, tools);
      if (other) {
        build.selectors.set(to, () => (from === "*" ? valuesValue(other) : readValue(other, from)));
      } else if (isCallable(source)) {
        build.selectors.set(to, () => {
          const selected = tools.call(source, [STORE_STATE, propsValue(build)]);
          return from === "*" || selected.kind !== "object"
            ? selected
            : getObjectProperty(selected, from);
        });
      } else {
        build.selectors.set(to, () =>
          unknownValue(`kea value ${to} connected from ${describeSource(source)}`),
        );
      }
    }
  }
};

const describeSource = (source: StaticValue): string =>
  source.kind === "unknown" ? source.reason : source.kind;

const LEGACY_INPUT_BUILDERS: ReadonlyArray<[string, (input: StaticValue) => KeaBuilder]> = [
  ["props", applyProps],
  ["key", applyKey],
  ["path", applyPath],
  ["connect", applyConnect],
  ["actions", applyActions],
  ["defaults", applyDefaults],
  ["reducers", applyReducers],
  ["selectors", applySelectors],
];

const applyInput = (build: KeaLogicBuild, input: StaticValue, tools: StubRenderTools): void => {
  const builder = BUILDERS.get(input);
  if (builder) return builder(build, tools);
  if (input.kind === "object") {
    for (const [key, apply] of LEGACY_INPUT_BUILDERS) {
      const value = getObjectProperty(input, key);
      if (!isUndefinedValue(value)) apply(value)(build, tools);
    }
    return;
  }
  if (isCallable(input)) {
    tools.call(input, [build.value]);
    return;
  }
  markUncertain(build, `kea logic input ${describeSource(input)}`);
};

const KEY_BUILDERS = new WeakSet<StaticValue>();

/** `key()` runs first so the build is cached per key, as `getBuiltLogic` does with `wrapper.keyBuilder`. */
const cacheKeyOf = (build: KeaLogicBuild, tools: StubRenderTools): string => {
  for (const input of build.wrapper.inputs) {
    const builder = BUILDERS.get(input);
    if (builder && KEY_BUILDERS.has(input)) builder(build, tools);
  }
  return build.key ? JSON.stringify(pathSegment(build.key) ?? describeSource(build.key)) : "";
};

const createBuild = (
  wrapper: KeaWrapper,
  props: StaticObjectValue,
  tools: StubRenderTools,
): KeaLogicBuild => {
  const build: KeaLogicBuild = {
    wrapper,
    path: null,
    key: null,
    props: Object.fromEntries(
      (getKnownObjectKeys(props) ?? []).map((key) => [key, getObjectProperty(props, key)]),
    ),
    defaults: new Map(),
    starDefault: null,
    selectors: new Map(),
    actions: new Map(),
    uncertainty: null,
    cache: objectValue(),
    tools,
    value: UNDEFINED_VALUE,
  };
  build.value = lazyProperties(objectValue(), (key) => builtLogicProperty(build, key));
  BUILDS.set(build.value, build);
  return build;
};

/** `logic.build(props)`: cached per key, with later props merged in (`getBuiltLogic`). */
const buildLogic = (
  wrapper: KeaWrapper,
  props: StaticObjectValue,
  tools: StubRenderTools,
): KeaLogicBuild => {
  const build = createBuild(wrapper, props, tools);
  const cacheKey = cacheKeyOf(build, tools);
  const cached = wrapper.builds.get(cacheKey);
  if (cached) {
    Object.assign(cached.props, build.props);
    return cached;
  }
  wrapper.builds.set(cacheKey, build);
  for (const input of wrapper.inputs) applyInput(build, input, tools);
  return build;
};

const toProps = (value: StaticValue | undefined): StaticObjectValue =>
  value?.kind === "object" ? value : objectValue();

const wrapperProperty = (wrapper: KeaWrapper, key: string, tools: StubRenderTools): StaticValue => {
  switch (key) {
    case "_isKea":
      return TRUE_VALUE;
    case "inputs":
      return listValue(wrapper.inputs);
    case "build":
    case "find":
      return nativeFunction(
        key,
        ([props], callTools) => buildLogic(wrapper, toProps(props), callTools).value,
      );
    case "findMounted":
      return nativeFunction(key, ([props], callTools) => {
        const build = buildLogic(wrapper, toProps(props), callTools);
        return mapValue(isMountedValue(build), (isMounted) =>
          isMounted.kind === "primitive" && isMounted.value === true ? build.value : NULL_VALUE,
        );
      });
    case "findAllMounted":
      return nativeFunction(key, () =>
        listValue([...wrapper.builds.values()].map((build) => build.value)),
      );
    case "isMounted":
      return nativeFunction(key, ([props], callTools) =>
        isMountedValue(buildLogic(wrapper, toProps(props), callTools)),
      );
    case "mount":
      return nativeFunction(key, ([props], callTools) => {
        buildLogic(wrapper, toProps(props), callTools);
        return noopFunction("unmount");
      });
    case "unmount":
      return noopFunction(key);
    case "extend":
      return nativeFunction(key, ([input]) => {
        if (input) wrapper.inputs.push(...(hasDefiniteItems(input) ? input.items : [input]));
        return wrapper.value;
      });
    case "wrap":
      return nativeFunction(key, () => unknownValue("kea-wrapped component"));
    default:
      return builtLogicProperty(buildLogic(wrapper, objectValue(), tools), key);
  }
};

const createWrapper = (input: StaticValue, project: ProjectContext): StaticValue => {
  const wrapper: KeaWrapper = {
    inputs: hasDefiniteItems(input) ? [...input.items] : [input],
    builds: new Map(),
    context: {
      name: "LogicContext",
      displayName: null,
      defaultValue: UNDEFINED_VALUE,
      location: null,
    },
    project,
    value: UNDEFINED_VALUE,
  };
  wrapper.value = lazyProperties(
    nativeFunction("kea logic", ([props], tools) =>
      isCallable(props ?? UNDEFINED_VALUE)
        ? unknownValue("kea-wrapped component")
        : buildLogic(wrapper, toProps(props), tools).value,
    ),
    (key, tools) => wrapperProperty(wrapper, key, tools),
  );
  WRAPPERS.set(wrapper.value, wrapper);
  return wrapper.value;
};

const builderValue = (name: string, apply: (input: StaticValue) => KeaBuilder): StaticValue =>
  nativeFunction(name, ([input]) => {
    const builder = nativeFunction(`${name} builder`, ([logic], tools) => {
      const build = logic ? BUILDS.get(logic) : undefined;
      if (build) apply(input ?? UNDEFINED_VALUE)(build, tools);
      return UNDEFINED_VALUE;
    });
    BUILDERS.set(builder, apply(input ?? UNDEFINED_VALUE));
    if (name === "key") KEY_BUILDERS.add(builder);
    return builder;
  });

const noopBuilder = (name: string): StaticValue => builderValue(name, () => () => undefined);

/** `useMountedLogic`: the bound instance from `BindLogic` above, else the keyless build. */
const mountedLogic = (logic: StaticValue, tools: StubRenderTools): KeaLogicBuild | null => {
  const wrapper = WRAPPERS.get(logic);
  if (!wrapper) return BUILDS.get(logic) ?? null;
  const bound = BUILDS.get(tools.readContext(wrapper.context));
  return bound ?? buildLogic(wrapper, objectValue(), tools);
};

const logicHook = (name: string, read: (build: KeaLogicBuild) => StaticValue): StaticValue =>
  nativeFunction(name, ([logic], tools) => {
    const build = logic ? mountedLogic(logic, tools) : null;
    return build
      ? read(build)
      : unknownValue(`${name} of ${logic ? describeSource(logic) : "nothing"}`);
  });

const BIND_LOGIC: StubComponent = {
  displayName: "BindLogic",
  render: (props, tools) => {
    const logic = getObjectProperty(props, "logic");
    const wrapper = WRAPPERS.get(logic);
    if (!wrapper) return getObjectProperty(props, "children");
    const build = buildLogic(wrapper, toProps(getObjectProperty(props, "props")), tools);
    return element(
      { kind: "context-provider", context: wrapper.context, displayName: null },
      objectFromRecord({ value: build.value, children: getObjectProperty(props, "children") }),
    );
  },
};

const isBuilt = (value: StaticValue): boolean => BUILDS.has(value);

export const keaValue: LibraryValueProvider = (specifier, importedName, project) => {
  if (specifier !== "kea") return null;
  switch (importedName) {
    case "kea":
      return nativeFunction("kea", ([input]) => createWrapper(input ?? listValue([]), project));
    case "path":
      return builderValue(importedName, applyPath);
    case "key":
      return builderValue(importedName, applyKey);
    case "props":
      return builderValue(importedName, applyProps);
    case "defaults":
      return builderValue(importedName, applyDefaults);
    case "actions":
      return builderValue(importedName, applyActions);
    case "reducers":
      return builderValue(importedName, applyReducers);
    case "selectors":
      return builderValue(importedName, applySelectors);
    case "connect":
      return builderValue(importedName, applyConnect);
    case "listeners":
    case "sharedListeners":
    case "events":
    case "afterMount":
    case "beforeUnmount":
    case "propsChanged":
      return noopBuilder(importedName);
    case "useValues":
    case "useAllValues":
      return logicHook(importedName, valuesValue);
    case "useActions":
      return logicHook(importedName, actionsValue);
    case "useAsyncActions":
      return logicHook(importedName, asyncActionsValue);
    case "useMountedLogic":
      return logicHook(importedName, (build) => build.value);
    case "useSelector":
      return nativeFunction(importedName, ([selector], tools) =>
        selector ? tools.call(selector, [STORE_STATE]) : UNDEFINED_VALUE,
      );
    case "BindLogic":
      return stubValue(BIND_LOGIC);
    case "Provider":
      return stubValue(passthroughStub("Provider"));
    case "isLogicWrapper":
      return nativeFunction(importedName, ([value]) =>
        value && WRAPPERS.has(value) ? TRUE_VALUE : FALSE_VALUE,
      );
    case "isBuiltLogic":
      return nativeFunction(importedName, ([value]) =>
        value && isBuilt(value) ? TRUE_VALUE : FALSE_VALUE,
      );
    case "isBreakpoint":
      return nativeFunction(importedName, () => FALSE_VALUE);
    case "resetContext":
    case "setPluginContext":
    case "activatePlugin":
      return noopFunction(importedName);
    case "getContext":
      return nativeFunction(importedName, () => unknownValue("kea's context"));
    case "getPluginContext":
      return nativeFunction(importedName, ([name]) =>
        unknownValue(`kea plugin context ${name?.kind === "primitive" ? String(name.value) : ""}`),
      );
    default:
      return null;
  }
};
