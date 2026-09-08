import {
  FALSE_VALUE,
  NULL_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  compareIdentity,
  describeValue,
  getKnownObjectKeys,
  getListItem,
  getListLength,
  getObjectAccessor,
  getObjectProperty,
  getTruthiness,
  isKnownString,
  isNullish,
  listValue,
  mapValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  setObjectProperty,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { element, nativeFunction, omitProps, stubValue } from "../frameworks/stubs.js";
import type {
  ContextDefinition,
  ExternalValueProvider,
  ReactApi,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";

// React Hook Form keeps every field in a mutable store and pushes changes to
// subscribers through hand-rolled subjects; interpreting that bookkeeping costs
// more steps than any render it feeds. The model keeps the observable
// contract as `createFormControl` defines it: the values, the form state and
// its render-tracking proxies, name-scoped subscriptions, and the hooks that
// read them (`useForm`, `useWatch`, `useFormState`, `useController`,
// `useFieldArray`). Validation results and generated ids stay unknown.

export const REACT_HOOK_FORM_PACKAGES = ["react-hook-form"];

const HOOK_FORM_CONTEXT: ContextDefinition = {
  name: "HookFormContext",
  displayName: "HookFormContext",
  defaultValue: NULL_VALUE,
  location: null,
};

const ROOT_PROXY_KEYS = [
  "isDirty",
  "dirtyFields",
  "validatingFields",
  "touchedFields",
  "isValidating",
  "isValid",
  "errors",
];
const LOCAL_PROXY_KEYS = ["isDirty", "isLoading", ...ROOT_PROXY_KEYS.slice(1)];
const RESERVED_PATH_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

type ProxyFormState = Map<string, boolean | "all">;

interface FormStatePayload {
  [key: string]: StaticValue;
}

interface StateSubscription {
  name: StaticValue;
  isExact: boolean;
  proxy: ProxyFormState;
  isRoot: boolean;
  notify: (payload: FormStatePayload, tools: StubRenderTools) => void;
}

interface ArraySubscription {
  notify: (payload: FormStatePayload, tools: StubRenderTools) => void;
}

/** `watch(callback)`: a raw `_subjects.state` observer that only reacts to payloads carrying `values`. */
interface ValueWatcher {
  callback: StaticValue;
  defaultValue: StaticValue;
}

interface FormNames {
  mount: Set<string>;
  array: Set<string>;
  watch: Set<string>;
  disabled: Set<string>;
  isWatchingAll: boolean;
}

interface FormControl {
  store: StaticObjectValue;
  options: StaticObjectValue;
  fields: Set<string>;
  names: FormNames;
  proxyFormState: ProxyFormState;
  proxySubscribeFormState: ProxyFormState;
  stateSubscriptions: Set<StateSubscription>;
  arraySubscriptions: Set<ArraySubscription>;
  valueWatchers: Set<ValueWatcher>;
  isMounted: boolean;
  shouldNotifyWatchers: boolean;
  control: StaticObjectValue;
  methods: StaticObjectValue;
}

interface FormInstance {
  control: FormControl;
  lastValues: StaticValue | null;
}

interface WatchInstance {
  defaultValue: StaticValue;
  computedValue: StaticValue | null;
}

interface FieldArrayInstance {
  ids: StaticValue[];
}

const formControls = new WeakMap<StaticObjectValue, FormControl>();
const formInstances = new WeakMap<StaticObjectValue, FormInstance>();
const watchInstances = new WeakMap<StaticObjectValue, WatchInstance>();
const localProxies = new WeakMap<StaticObjectValue, ProxyFormState>();
const fieldArrayInstances = new WeakMap<StaticObjectValue, FieldArrayInstance>();
const ruleRegistrations = new WeakMap<StaticObjectValue, boolean>();

const reactApi = (api: ReactApi): StaticValue => ({ kind: "react-api", api });

const isUndefined = (value: StaticValue | undefined): boolean =>
  value === undefined || (value.kind === "primitive" && value.value === undefined);

const isCallable = (value: StaticValue | undefined): value is StaticValue =>
  value?.kind === "function" || value?.kind === "native-function";

const knownString = (value: StaticValue | undefined): string | null =>
  value !== undefined && isKnownString(value) ? value.value : null;

const booleanValue = (value: boolean | null, reason: string): StaticValue =>
  value === null ? unknownPrimitiveValue("boolean", reason) : value ? TRUE_VALUE : FALSE_VALUE;

const propertyOf = (object: StaticValue | undefined, key: string): StaticValue =>
  object === undefined ? UNDEFINED_VALUE : readKey(object, key);

const isTruthy = (value: StaticValue | undefined): boolean =>
  value !== undefined && getTruthiness(value) === true;

const orValue = (left: StaticValue, right: StaticValue): StaticValue => {
  const truthiness = getTruthiness(left);
  if (truthiness === true) return left;
  if (truthiness === false) return right;
  return branchValue([left, right], `|| on ${describeValue(left)}`);
};

/** Reads `key` as a member expression would, running an accessor's getter. */
const readProperty = (object: StaticValue, key: string, tools: StubRenderTools): StaticValue => {
  if (object.kind !== "object") return propertyOf(object, key);
  const accessor = getObjectAccessor(object, key);
  return accessor?.get ? tools.call(accessor.get, []) : getObjectProperty(object, key);
};

const entriesOf = (record: FormStatePayload): StaticObjectEntry[] =>
  Object.entries(record).map(([key, value]) => ({
    kind: "property",
    key,
    value,
  }));

const withProperties = (base: StaticValue, record: FormStatePayload): StaticValue =>
  mapValue(base, (alternative) => {
    if (alternative.kind !== "object") return alternative;
    const copy = objectValue([...alternative.entries]);
    for (const [key, value] of Object.entries(record)) setObjectProperty(copy, key, value);
    return copy;
  });

/** `{ ...value }`: a shallow copy, spreading a value the analysis cannot enumerate. */
const spreadCopy = (value: StaticValue): StaticObjectValue =>
  value.kind === "object"
    ? objectValue([...value.entries])
    : objectValue(isNullish(value) === true ? [] : [{ kind: "spread", value }]);

/** `cloneObject`: plain objects and arrays copy deeply, class instances and dates by reference. */
const cloneValue = (value: StaticValue): StaticValue => {
  if (value.kind === "list") return listValue(value.items.map(cloneValue));
  if (value.kind !== "object" || value.constructedBy || value.prototype) return value;
  return objectValue(
    value.entries.map((entry) =>
      entry.kind === "property" && !entry.accessor
        ? { kind: "property", key: entry.key, value: cloneValue(entry.value) }
        : entry,
    ),
  );
};

const isEmptyObject = (value: StaticValue): boolean | null => {
  if (value.kind !== "object") return isNullish(value) === true ? false : null;
  const keys = getKnownObjectKeys(value);
  return keys === null ? null : keys.length === 0;
};

/** `deepEqual` as the library defines it, undecided when a value is not known whole. */
const compareDeeply = (left: StaticValue, right: StaticValue, depth = 0): boolean | null => {
  const identity = compareIdentity(left, right);
  if (identity === true || depth > 8) return identity;
  if (left.kind === "list" && right.kind === "list") {
    if ([...left.items, ...right.items].some(isIndefinite)) return null;
    if (left.items.length !== right.items.length) return false;
    return combineComparisons(
      left.items.map((item, index) => compareDeeply(item, right.items[index], depth + 1)),
    );
  }
  if (left.kind !== "object" || right.kind !== "object") return identity;
  const leftKeys = getKnownObjectKeys(left);
  const rightKeys = getKnownObjectKeys(right);
  if (!leftKeys || !rightKeys) return null;
  if (leftKeys.length !== rightKeys.length || !leftKeys.every((key) => rightKeys.includes(key)))
    return false;
  return combineComparisons(
    leftKeys
      .filter((key) => key !== "ref")
      .map((key) =>
        compareDeeply(getObjectProperty(left, key), getObjectProperty(right, key), depth + 1),
      ),
  );
};

const combineComparisons = (results: Array<boolean | null>): boolean | null =>
  results.includes(false) ? false : results.includes(null) ? null : true;

const isIndefinite = (item: StaticValue): boolean =>
  item.kind === "repeat" || item.kind === "optional";

const toPath = (name: string): string[] =>
  name
    .replace(/["|']|\]/g, "")
    .split(/\.|\[/)
    .filter(Boolean);

const readKey = (container: StaticValue, key: string): StaticValue =>
  mapValue(container, (alternative) => {
    switch (alternative.kind) {
      case "object":
        return getObjectProperty(alternative, key);
      case "list": {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0)
          return getListItem(alternative.items, index, null);
        return key === "length" ? getListLength(alternative) : UNDEFINED_VALUE;
      }
      case "primitive":
        return alternative.value === null || alternative.value === undefined
          ? alternative
          : UNDEFINED_VALUE;
      default:
        return unknownValue(`"${key}" of ${describeValue(alternative)}`);
    }
  });

/** `get(object, path, defaultValue)`. */
const readPath = (
  object: StaticValue,
  path: string,
  defaultValue: StaticValue = UNDEFINED_VALUE,
): StaticValue => {
  if (!path) return defaultValue;
  let current = object;
  for (const key of toPath(path)) {
    current = readKey(current, key);
    if (isNullish(current) === true) break;
  }
  return isUndefined(current) ? defaultValue : current;
};

/** `set(object, path, value)` on a copy, so the store's previous snapshot stays intact. */
const writePath = (container: StaticValue, keys: string[], value: StaticValue): StaticValue => {
  const [key, ...rest] = keys;
  if (key === undefined) return value;
  if (RESERVED_PATH_KEYS.has(key)) return container;
  if (container.kind === "branch") {
    return mapValue(container, (alternative) => writePath(alternative, keys, value));
  }
  const index = Number(key);
  if (container.kind === "list" && Number.isInteger(index) && index >= 0) {
    if (container.items.some(isIndefinite)) {
      return unknownValue(`"${key}" set on a partially known list`);
    }
    const items = [...container.items];
    while (items.length <= index) items.push(UNDEFINED_VALUE);
    items[index] = writePath(items[index], rest, value);
    return listValue(items);
  }
  if (container.kind === "object") {
    const copy = objectValue([...container.entries]);
    setObjectProperty(copy, key, writePath(getObjectProperty(container, key), rest, value));
    return copy;
  }
  if (isNullish(container) === true) {
    const [nextKey] = rest;
    const created =
      nextKey !== undefined && !Number.isNaN(Number(nextKey)) ? listValue([]) : objectValue();
    return writePath(created, keys, value);
  }
  return unknownValue(`"${key}" set on ${describeValue(container)}`);
};

const unsetPath = (container: StaticValue, path: string): StaticValue =>
  writePath(container, toPath(path), UNDEFINED_VALUE);

const getNodeParentName = (name: string): string =>
  name.substring(0, name.search(/\.\d+(\.|$)/)) || name;

const isWatched = (name: string, names: FormNames): boolean =>
  names.isWatchingAll ||
  names.watch.has(name) ||
  [...names.watch].some(
    (watched) => name.startsWith(watched) && /^\.\w+/.test(name.slice(watched.length)),
  );

const nameList = (name: StaticValue): Array<string | null> | null => {
  if (name.kind === "list") {
    return name.items.some(isIndefinite) ? null : name.items.map(knownString);
  }
  return [knownString(name)];
};

const shouldSubscribeByName = (
  name: StaticValue,
  signalName: StaticValue | undefined,
  isExact: boolean,
): boolean => {
  if (getTruthiness(name) !== true || signalName === undefined) return true;
  if (getTruthiness(signalName) !== true) return true;
  const signal = knownString(signalName);
  const names = nameList(name);
  if (signal === null || names === null || names.includes(null)) return true;
  return names.some(
    (current) =>
      current !== null &&
      (isExact ? current === signal : current.startsWith(signal) || signal.startsWith(current)),
  );
};

const shouldRenderFormState = (
  payload: FormStatePayload,
  proxy: ProxyFormState,
  isRoot: boolean,
): boolean => {
  const keys = Object.keys(payload).filter((key) => key !== "name");
  return (
    keys.length === 0 ||
    keys.length >= proxy.size ||
    keys.some((key) => proxy.get(key) === (isRoot ? "all" : true))
  );
};

const readStore = (
  control: FormControl,
  key: "formValues" | "defaultValues" | "formState",
): StaticValue => getObjectProperty(control.store, key);

const writeStore = (
  control: FormControl,
  key: "formValues" | "defaultValues" | "formState",
  value: StaticValue,
  tools: StubRenderTools,
): void => {
  tools.setProperty(control.store, key, value);
};

const readFormState = (control: FormControl, key: string): StaticValue =>
  propertyOf(readStore(control, "formState"), key);

const mergeFormState = (
  control: FormControl,
  payload: FormStatePayload,
  tools: StubRenderTools,
): void => {
  writeStore(control, "formState", withProperties(readStore(control, "formState"), payload), tools);
};

const isProxied = (control: FormControl, key: string): boolean =>
  Boolean(control.proxyFormState.get(key) || control.proxySubscribeFormState.get(key));

const notifyState = (
  control: FormControl,
  payload: FormStatePayload,
  tools: StubRenderTools,
): void => {
  for (const subscription of Array.from(control.stateSubscriptions)) {
    if (!shouldSubscribeByName(subscription.name, payload.name, subscription.isExact)) continue;
    mergeFormState(control, payload, tools);
    if (shouldRenderFormState(payload, subscription.proxy, subscription.isRoot)) {
      subscription.notify(payload, tools);
    }
  }
  if (payload.values === undefined) return;
  for (const watcher of Array.from(control.valueWatchers)) {
    tools.call(watcher.callback, [
      getWatch(control, undefined, watcher.defaultValue, false),
      objectFromRecord(payload),
    ]);
  }
};

const subscribeValueWatcher = (control: FormControl, watcher: ValueWatcher): StaticValue => {
  control.valueWatchers.add(watcher);
  return objectFromRecord({
    unsubscribe: nativeFunction("unsubscribe", () => {
      control.valueWatchers.delete(watcher);
      return UNDEFINED_VALUE;
    }),
  });
};

const notifyArray = (
  control: FormControl,
  payload: FormStatePayload,
  tools: StubRenderTools,
): void => {
  for (const subscription of Array.from(control.arraySubscriptions))
    subscription.notify(payload, tools);
};

const subscribeState = (control: FormControl, subscription: StateSubscription): StaticValue => {
  control.stateSubscriptions.add(subscription);
  return nativeFunction("unsubscribe", () => {
    control.stateSubscriptions.delete(subscription);
    return UNDEFINED_VALUE;
  });
};

/** The `formState` argument of `subscribe`/`_subscribe` as a proxy record. */
const toProxyFormState = (formState: StaticValue | undefined, keys: string[]): ProxyFormState => {
  const proxy: ProxyFormState = new Map(keys.map((key) => [key, false]));
  if (formState?.kind !== "object") return proxy;
  for (const key of getKnownObjectKeys(formState) ?? []) {
    const flag = getObjectProperty(formState, key);
    if (knownString(flag) === "all") proxy.set(key, "all");
    else if (getTruthiness(flag) === true) proxy.set(key, true);
  }
  return proxy;
};

const subscriptionPayload = (control: FormControl, payload: FormStatePayload): StaticValue => {
  const formState = readStore(control, "formState");
  return objectValue([
    {
      kind: "property",
      key: "values",
      value: spreadCopy(readStore(control, "formValues")),
    },
    ...(formState.kind === "object" ? formState.entries : []),
    ...entriesOf(payload),
    {
      kind: "property",
      key: "defaultValues",
      value: readStore(control, "defaultValues"),
    },
  ]);
};

const generateWatchOutput = (
  names: StaticValue | undefined,
  formNames: FormNames,
  formValues: StaticValue,
  isGlobal: boolean,
  defaultValue: StaticValue,
): StaticValue => {
  const name = knownString(names);
  if (name !== null) {
    if (isGlobal) formNames.watch.add(name);
    return readPath(formValues, name, defaultValue);
  }
  if (names?.kind === "list") {
    const fieldNames = nameList(names);
    if (fieldNames === null || fieldNames.includes(null)) {
      return unknownValue("watched field names are not known");
    }
    return listValue(
      fieldNames.map((fieldName) => {
        if (isGlobal && fieldName !== null) formNames.watch.add(fieldName);
        return readPath(formValues, fieldName ?? "");
      }),
    );
  }
  if (names === undefined || isNullish(names) === true) {
    if (isGlobal) formNames.isWatchingAll = true;
    return formValues;
  }
  return unknownValue(`watched field name is ${describeValue(names)}`);
};

const getWatch = (
  control: FormControl,
  names: StaticValue | undefined,
  defaultValue: StaticValue,
  isGlobal: boolean,
): StaticValue => {
  const name = knownString(names);
  const source = control.isMounted
    ? readStore(control, "formValues")
    : isUndefined(defaultValue)
      ? readStore(control, "defaultValues")
      : name !== null
        ? objectFromRecord({ [name]: defaultValue })
        : defaultValue;
  return generateWatchOutput(names, control.names, spreadCopy(source), isGlobal, defaultValue);
};

const getValues = (control: FormControl, fieldNames: StaticValue | undefined): StaticValue => {
  const values = spreadCopy(readStore(control, control.isMounted ? "formValues" : "defaultValues"));
  if (fieldNames === undefined || isUndefined(fieldNames)) return values;
  const name = knownString(fieldNames);
  if (name !== null) return readPath(values, name);
  const names = nameList(fieldNames);
  if (names === null || names.includes(null)) return unknownValue("field names are not known");
  return listValue(names.map((fieldName) => readPath(values, fieldName ?? "")));
};

const getDirty = (control: FormControl): StaticValue =>
  isTruthy(getObjectProperty(control.options, "disabled"))
    ? FALSE_VALUE
    : booleanValue(
        mapComparison(
          compareDeeply(getValues(control, undefined), readStore(control, "defaultValues")),
          (isEqual) => !isEqual,
        ),
        "whether the form values differ from the default values",
      );

const mapComparison = (
  result: boolean | null,
  transform: (value: boolean) => boolean,
): boolean | null => (result === null ? null : transform(result));

const getFieldArray = (control: FormControl, name: string): StaticValue => {
  const fallback = isTruthy(getObjectProperty(control.options, "shouldUnregister"))
    ? readPath(readStore(control, "defaultValues"), name, listValue([]))
    : listValue([]);
  const values = readPath(
    readStore(control, control.isMounted ? "formValues" : "defaultValues"),
    name,
    fallback,
  );
  if (values.kind !== "list") {
    return isNullish(values) === true
      ? listValue([])
      : unknownValue(`field array "${name}" is ${describeValue(values)}`);
  }
  return listValue(values.items.filter((item) => getTruthiness(item) !== false));
};

const runSchema = (
  control: FormControl,
  names: string[],
  tools: StubRenderTools,
): StaticValue | null => {
  const resolver = getObjectProperty(control.options, "resolver");
  if (!isCallable(resolver)) return null;
  const result = tools.callAwaited(resolver, [
    readStore(control, "formValues"),
    getObjectProperty(control.options, "context"),
    objectFromRecord({
      criteriaMode: getObjectProperty(control.options, "criteriaMode"),
      fields: objectValue(),
      names: listValue(names.map((name) => primitiveValue(name))),
      shouldUseNativeValidation: getObjectProperty(control.options, "shouldUseNativeValidation"),
    }),
  ]);
  return result.kind === "object"
    ? getObjectProperty(result, "errors")
    : unknownValue(`resolver returned ${describeValue(result)}`);
};

const setValid = (
  control: FormControl,
  shouldUpdateValid: boolean,
  tools: StubRenderTools,
): void => {
  if (isTruthy(getObjectProperty(control.options, "disabled"))) return;
  if (!isProxied(control, "isValid") && !shouldUpdateValid) return;
  const errors = runSchema(control, [...control.names.mount], tools);
  const isValid =
    errors === null
      ? unknownPrimitiveValue("boolean", "whether the registered fields pass their rules")
      : booleanValue(isEmptyObject(errors), "whether the resolver reports no errors");
  if (compareIdentity(isValid, readFormState(control, "isValid")) !== true) {
    notifyState(control, { isValid }, tools);
  }
};

const updateValidAndValue = (
  control: FormControl,
  name: string,
  value: StaticValue,
  tools: StubRenderTools,
): void => {
  const formValues = readStore(control, "formValues");
  const defaultValue = readPath(
    formValues,
    name,
    isUndefined(value) ? readPath(readStore(control, "defaultValues"), name) : value,
  );
  writeStore(control, "formValues", writePath(formValues, toPath(name), defaultValue), tools);
  if (control.isMounted) setValid(control, false, tools);
};

const setDisabledField = (control: FormControl, name: string, disabled: StaticValue): void => {
  const isDisabled = getTruthiness(disabled);
  if (isDisabled === true) control.names.disabled.add(name);
  else if (isDisabled === false && control.names.disabled.has(name))
    control.names.disabled.delete(name);
};

const updateTouchAndDirty = (
  control: FormControl,
  name: string,
  fieldValue: StaticValue,
  shouldTouch: boolean,
  shouldDirty: boolean,
  tools: StubRenderTools,
): void => {
  if (isTruthy(getObjectProperty(control.options, "disabled"))) return;
  const output: FormStatePayload = { name: primitiveValue(name) };
  let shouldUpdateField: boolean | null = false;
  if (!shouldTouch || shouldDirty) {
    if (isProxied(control, "isDirty")) {
      const isDirty = getDirty(control);
      output.isDirty = isDirty;
      shouldUpdateField = mapComparison(
        compareIdentity(isDirty, readFormState(control, "isDirty")),
        (isSame) => !isSame,
      );
    }
    const isPristine = compareDeeply(
      readPath(readStore(control, "defaultValues"), name),
      fieldValue,
    );
    const dirtyFields = readFormState(control, "dirtyFields");
    const wasDirty = getTruthiness(readPath(dirtyFields, name));
    output.dirtyFields =
      isPristine === null
        ? unknownValue(`whether "${name}" is dirty`)
        : isPristine
          ? unsetPath(dirtyFields, name)
          : writePath(dirtyFields, toPath(name), TRUE_VALUE);
    if (isProxied(control, "dirtyFields") && shouldUpdateField !== true) {
      shouldUpdateField =
        isPristine === null || wasDirty === null ? null : wasDirty !== !isPristine;
    }
  }
  if (shouldTouch) {
    const touchedFields = readFormState(control, "touchedFields");
    if (getTruthiness(readPath(touchedFields, name)) !== true) {
      output.touchedFields = writePath(touchedFields, toPath(name), TRUE_VALUE);
      if (isProxied(control, "touchedFields")) shouldUpdateField = true;
    }
  }
  if (shouldUpdateField !== false) {
    mergeFormState(control, output, tools);
    notifyState(control, output, tools);
  }
};

/** Validation after a change depends on the input, so its outcome is unknown. */
const invalidateErrors = (
  control: FormControl,
  name: string,
  tools: StubRenderTools,
  isForced = false,
): void => {
  const mode = knownString(getObjectProperty(control.options, "mode")) ?? "onSubmit";
  const isSubmitted = getTruthiness(readFormState(control, "isSubmitted"));
  if (!isForced && mode === "onSubmit" && isSubmitted === false) return;
  notifyState(
    control,
    {
      name: primitiveValue(name),
      errors: unknownValue(`errors after validating "${name}"`),
      ...(isProxied(control, "isValid")
        ? {
            isValid: unknownPrimitiveValue("boolean", `validity after validating "${name}"`),
          }
        : {}),
    },
    tools,
  );
};

const setValue = (
  control: FormControl,
  nameValue: StaticValue,
  value: StaticValue,
  options: StaticValue,
  tools: StubRenderTools,
): void => {
  const name = knownString(nameValue);
  if (name === null) {
    writeStore(
      control,
      "formValues",
      unknownValue(`form values after setting ${describeValue(nameValue)}`),
      tools,
    );
    notifyState(control, { values: readStore(control, "formValues") }, tools);
    return;
  }
  const cloned = cloneValue(value);
  writeStore(
    control,
    "formValues",
    writePath(readStore(control, "formValues"), toPath(name), cloned),
    tools,
  );
  const shouldDirty = isTruthy(propertyOf(options, "shouldDirty"));
  const shouldTouch = isTruthy(propertyOf(options, "shouldTouch"));
  if (control.names.array.has(name)) {
    notifyArray(
      control,
      { name: nameValue, values: cloneValue(readStore(control, "formValues")) },
      tools,
    );
    if ((isProxied(control, "isDirty") || isProxied(control, "dirtyFields")) && shouldDirty) {
      notifyState(
        control,
        {
          name: nameValue,
          dirtyFields: unknownValue("dirty fields after replacing a field array"),
          isDirty: getDirty(control),
        },
        tools,
      );
    }
  } else {
    if (control.fields.has(name)) {
      notifyState(
        control,
        {
          name: nameValue,
          values: cloneValue(readStore(control, "formValues")),
        },
        tools,
      );
    }
    if (shouldDirty || shouldTouch) {
      updateTouchAndDirty(control, name, cloned, shouldTouch, shouldDirty, tools);
    }
    if (isTruthy(propertyOf(options, "shouldValidate"))) invalidateErrors(control, name, tools);
  }
  if (isWatched(name, control.names)) {
    const formState = readStore(control, "formState");
    notifyState(
      control,
      {
        ...(formState.kind === "object"
          ? Object.fromEntries(
              (getKnownObjectKeys(formState) ?? []).map((key) => [
                key,
                getObjectProperty(formState, key),
              ]),
            )
          : {}),
        name: nameValue,
      },
      tools,
    );
  }
  notifyState(
    control,
    {
      name: control.isMounted ? nameValue : UNDEFINED_VALUE,
      values: cloneValue(readStore(control, "formValues")),
    },
    tools,
  );
};

const handleChange = (control: FormControl): StaticValue =>
  nativeFunction("onChange", ([event], tools) => {
    control.isMounted = true;
    const target = propertyOf(event, "target");
    const name = knownString(propertyOf(target, "name"));
    if (name === null) {
      writeStore(control, "formValues", unknownValue("form values after a change event"), tools);
      notifyState(control, { values: readStore(control, "formValues") }, tools);
      return UNDEFINED_VALUE;
    }
    const isBlur = knownString(propertyOf(event, "type")) === "blur";
    if (!isBlur) {
      const value = eventValue(event);
      writeStore(
        control,
        "formValues",
        writePath(readStore(control, "formValues"), toPath(name), value),
        tools,
      );
      updateTouchAndDirty(control, name, value, false, false, tools);
      notifyState(
        control,
        {
          name: primitiveValue(name),
          values: cloneValue(readStore(control, "formValues")),
        },
        tools,
      );
    } else {
      updateTouchAndDirty(
        control,
        name,
        readPath(readStore(control, "formValues"), name),
        true,
        false,
        tools,
      );
    }
    invalidateErrors(control, name, tools);
    return UNDEFINED_VALUE;
  });

const register = (
  control: FormControl,
  nameValue: StaticValue,
  options: StaticValue,
  tools: StubRenderTools,
): StaticValue => {
  const name = knownString(nameValue);
  const disabled = propertyOf(options, "disabled");
  const formDisabled = getObjectProperty(control.options, "disabled");
  const isDisabledDefined =
    disabled.kind === "primitive" && typeof disabled.value === "boolean"
      ? true
      : formDisabled.kind === "primitive" && typeof formDisabled.value === "boolean";
  if (name !== null) {
    const isRegistered = control.fields.has(name);
    control.fields.add(name);
    control.names.mount.add(name);
    if (isRegistered) {
      setDisabledField(control, name, isUndefined(disabled) ? formDisabled : disabled);
    } else {
      updateValidAndValue(control, name, propertyOf(options, "value"), tools);
    }
  } else {
    writeStore(
      control,
      "formValues",
      unknownValue(`form values after registering ${describeValue(nameValue)}`),
      tools,
    );
  }
  const onChange = handleChange(control);
  return objectFromRecord({
    ...(isDisabledDefined ? { disabled: orValue(disabled, formDisabled) } : {}),
    name: nameValue,
    onChange,
    onBlur: onChange,
    ref: nativeFunction("ref", () => UNDEFINED_VALUE),
  });
};

const getFieldState = (
  control: FormControl,
  nameValue: StaticValue,
  formState: StaticValue | undefined,
  tools: StubRenderTools,
): StaticValue => {
  const name = knownString(nameValue);
  if (name === null) return unknownValue(`field state of ${describeValue(nameValue)}`);
  const source =
    formState === undefined || isUndefined(formState) ? readStore(control, "formState") : formState;
  const read = (key: string): StaticValue => readPath(readProperty(source, key, tools), name);
  const truthy = (value: StaticValue, reason: string): StaticValue =>
    booleanValue(getTruthiness(value), reason);
  const error = read("errors");
  return objectFromRecord({
    invalid: truthy(error, `whether "${name}" has an error`),
    isDirty: truthy(read("dirtyFields"), `whether "${name}" is dirty`),
    error,
    isValidating: truthy(
      readPath(readFormState(control, "validatingFields"), name),
      `whether "${name}" is validating`,
    ),
    isTouched: truthy(read("touchedFields"), `whether "${name}" was touched`),
  });
};

const setError = (
  control: FormControl,
  nameValue: StaticValue,
  error: StaticValue,
  tools: StubRenderTools,
): void => {
  const name = knownString(nameValue);
  const errors = readFormState(control, "errors");
  const nextErrors =
    name === null
      ? unknownValue(`errors after setting one on ${describeValue(nameValue)}`)
      : writePath(
          errors,
          toPath(name),
          withProperties(spreadCopy(error), { ref: UNDEFINED_VALUE }),
        );
  notifyState(control, { name: nameValue, errors: nextErrors, isValid: FALSE_VALUE }, tools);
};

const clearErrors = (
  control: FormControl,
  nameValue: StaticValue | undefined,
  tools: StubRenderTools,
): void => {
  if (nameValue === undefined || getTruthiness(nameValue) === false) {
    notifyState(control, { errors: objectValue() }, tools);
    return;
  }
  const names = nameList(nameValue);
  let errors = readFormState(control, "errors");
  if (names === null || names.includes(null)) {
    errors = unknownValue(`errors after clearing ${describeValue(nameValue)}`);
  } else {
    for (const name of names) if (name !== null) errors = unsetPath(errors, name);
  }
  notifyState(control, { errors }, tools);
};

const resetForm = (
  control: FormControl,
  formValues: StaticValue | undefined,
  keepStateOptions: StaticValue | undefined,
  tools: StubRenderTools,
): void => {
  const keep = (key: string): boolean => isTruthy(propertyOf(keepStateOptions, key));
  const defaultValues = readStore(control, "defaultValues");
  const hasValues = formValues !== undefined && getTruthiness(formValues) !== false;
  const updatedValues = hasValues ? cloneValue(formValues) : defaultValues;
  const isEmptyReset = formValues === undefined || isEmptyObject(formValues) === true;
  const values = isEmptyReset ? defaultValues : cloneValue(updatedValues);
  if (!keep("keepDefaultValues")) writeStore(control, "defaultValues", updatedValues, tools);
  if (!keep("keepValues")) {
    if (!keep("keepFieldsRef") && !keep("keepDirtyValues")) control.fields.clear();
    writeStore(
      control,
      "formValues",
      isTruthy(getObjectProperty(control.options, "shouldUnregister"))
        ? keep("keepDefaultValues")
          ? cloneValue(readStore(control, "defaultValues"))
          : objectValue()
        : cloneValue(values),
      tools,
    );
    notifyArray(control, { values: spreadCopy(values) }, tools);
    notifyState(control, { values: spreadCopy(values) }, tools);
  }
  control.names = {
    mount: keep("keepDirtyValues") ? control.names.mount : new Set(),
    array: new Set(),
    watch: new Set(),
    disabled: new Set(),
    isWatchingAll: false,
  };
  control.isMounted =
    !control.proxyFormState.get("isValid") || keep("keepIsValid") || keep("keepDirtyValues");
  control.shouldNotifyWatchers = isTruthy(getObjectProperty(control.options, "shouldUnregister"));
  const formState = (key: string): StaticValue => readFormState(control, key);
  notifyState(
    control,
    {
      submitCount: keep("keepSubmitCount") ? formState("submitCount") : primitiveValue(0),
      isDirty: isEmptyReset
        ? FALSE_VALUE
        : keep("keepDirty")
          ? formState("isDirty")
          : keep("keepDefaultValues") && formValues !== undefined
            ? booleanValue(
                mapComparison(compareDeeply(formValues, defaultValues), (isEqual) => !isEqual),
                "whether the reset values differ from the kept defaults",
              )
            : FALSE_VALUE,
      isSubmitted: keep("keepIsSubmitted") ? formState("isSubmitted") : FALSE_VALUE,
      dirtyFields: isEmptyReset
        ? objectValue()
        : keep("keepDirtyValues") || keep("keepDefaultValues")
          ? unknownValue("dirty fields after a reset that keeps values")
          : keep("keepDirty")
            ? formState("dirtyFields")
            : objectValue(),
      touchedFields: keep("keepTouched") ? formState("touchedFields") : objectValue(),
      errors: keep("keepErrors") ? formState("errors") : objectValue(),
      isSubmitSuccessful: keep("keepIsSubmitSuccessful")
        ? formState("isSubmitSuccessful")
        : FALSE_VALUE,
      isSubmitting: FALSE_VALUE,
      defaultValues: readStore(control, "defaultValues"),
    },
    tools,
  );
};

const unregister = (
  control: FormControl,
  nameValue: StaticValue | undefined,
  options: StaticValue | undefined,
  tools: StubRenderTools,
): void => {
  const keep = (key: string): boolean => isTruthy(propertyOf(options, key));
  const names =
    nameValue === undefined || getTruthiness(nameValue) === false
      ? [...control.names.mount]
      : nameList(nameValue);
  if (names === null || names.includes(null)) {
    writeStore(
      control,
      "formValues",
      unknownValue("form values after unregistering unknown fields"),
      tools,
    );
    notifyState(control, { values: readStore(control, "formValues") }, tools);
    return;
  }
  let formValues = readStore(control, "formValues");
  let defaultValues = readStore(control, "defaultValues");
  const state: FormStatePayload = {};
  for (const name of names) {
    if (name === null) continue;
    control.names.mount.delete(name);
    control.names.array.delete(name);
    if (!keep("keepValue")) {
      control.fields.delete(name);
      formValues = unsetPath(formValues, name);
    }
    if (!keep("keepError"))
      state.errors = unsetPath(state.errors ?? readFormState(control, "errors"), name);
    if (!keep("keepDirty"))
      state.dirtyFields = unsetPath(
        state.dirtyFields ?? readFormState(control, "dirtyFields"),
        name,
      );
    if (!keep("keepTouched"))
      state.touchedFields = unsetPath(
        state.touchedFields ?? readFormState(control, "touchedFields"),
        name,
      );
    if (
      !isTruthy(getObjectProperty(control.options, "shouldUnregister")) &&
      !keep("keepDefaultValue")
    ) {
      defaultValues = unsetPath(defaultValues, name);
    }
  }
  writeStore(control, "formValues", formValues, tools);
  writeStore(control, "defaultValues", defaultValues, tools);
  mergeFormState(control, state, tools);
  notifyState(control, { values: cloneValue(formValues) }, tools);
  const formState = readStore(control, "formState");
  notifyState(
    control,
    {
      ...(formState.kind === "object"
        ? Object.fromEntries(
            (getKnownObjectKeys(formState) ?? []).map((key) => [
              key,
              getObjectProperty(formState, key),
            ]),
          )
        : {}),
      ...(keep("keepDirty") ? { isDirty: getDirty(control) } : {}),
    },
    tools,
  );
  if (!keep("keepIsValid")) setValid(control, false, tools);
};

const initialFormState = (
  props: StaticObjectValue,
  withDefaultValues: boolean,
): StaticObjectValue => {
  const defaultValues = getObjectProperty(props, "defaultValues");
  const isDefaultsFunction = isCallable(defaultValues);
  return objectFromRecord({
    submitCount: primitiveValue(0),
    isDirty: FALSE_VALUE,
    isReady: FALSE_VALUE,
    isLoading: booleanValue(
      defaultValues.kind === "unknown" || defaultValues.kind === "branch"
        ? null
        : isDefaultsFunction,
      "whether default values are loaded asynchronously",
    ),
    isValidating: FALSE_VALUE,
    isSubmitted: FALSE_VALUE,
    isSubmitting: FALSE_VALUE,
    isSubmitSuccessful: FALSE_VALUE,
    isValid: FALSE_VALUE,
    touchedFields: objectValue(),
    dirtyFields: objectValue(),
    validatingFields: objectValue(),
    errors: orValue(getObjectProperty(props, "errors"), objectValue()),
    disabled: orValue(getObjectProperty(props, "disabled"), FALSE_VALUE),
    ...(withDefaultValues
      ? { defaultValues: isDefaultsFunction ? UNDEFINED_VALUE : defaultValues }
      : {}),
  });
};

const initialDefaultValues = (props: StaticObjectValue): StaticValue => {
  const defaultValues = getObjectProperty(props, "defaultValues");
  const values = getObjectProperty(props, "values");
  const source = orValue(defaultValues, values);
  if (source.kind === "object") return cloneValue(source);
  if (isCallable(source) || isNullish(source) === true) return objectValue();
  return unknownValue(`default values are ${describeValue(source)}`);
};

const handleSubmit = (control: FormControl): StaticValue =>
  nativeFunction("handleSubmit", ([onValid, onInvalid]) =>
    nativeFunction("onSubmit", ([event], tools) => {
      const preventDefault = propertyOf(event, "preventDefault");
      if (isCallable(preventDefault)) tools.call(preventDefault, []);
      notifyState(control, { isSubmitting: TRUE_VALUE }, tools);
      const errors = runSchema(control, [...control.names.mount], tools);
      const isValid = errors === null ? null : isEmptyObject(errors);
      if (isValid === true && isCallable(onValid)) {
        notifyState(control, { errors: objectValue() }, tools);
        tools.callAwaited(onValid, [readStore(control, "formValues"), event ?? UNDEFINED_VALUE]);
      } else if (isValid === false && isCallable(onInvalid) && errors) {
        tools.callAwaited(onInvalid, [errors, event ?? UNDEFINED_VALUE]);
      }
      notifyState(
        control,
        {
          isSubmitted: TRUE_VALUE,
          isSubmitting: FALSE_VALUE,
          isSubmitSuccessful: booleanValue(isValid, "whether the submitted values were valid"),
          submitCount: unknownPrimitiveValue("number", "submit count after a submit"),
          errors: errors ?? unknownValue("errors after validating a submit"),
        },
        tools,
      );
      return unknownValue("promise of a submit handler");
    }),
  );

const createFormControl = (props: StaticObjectValue): FormControl => {
  const defaultValues = initialDefaultValues(props);
  const store = objectFromRecord({
    formValues: isTruthy(getObjectProperty(props, "shouldUnregister"))
      ? objectValue()
      : cloneValue(defaultValues),
    defaultValues,
    formState: initialFormState(props, false),
  });
  const control: FormControl = {
    store,
    options: props,
    fields: new Set(),
    names: {
      mount: new Set(),
      array: new Set(),
      watch: new Set(),
      disabled: new Set(),
      isWatchingAll: false,
    },
    proxyFormState: new Map(ROOT_PROXY_KEYS.map((key) => [key, false])),
    proxySubscribeFormState: new Map(ROOT_PROXY_KEYS.map((key) => [key, false])),
    stateSubscriptions: new Set(),
    arraySubscriptions: new Set(),
    valueWatchers: new Set(),
    isMounted: false,
    shouldNotifyWatchers: false,
    control: objectValue(),
    methods: objectValue(),
  };
  const registerFunction = nativeFunction("register", ([name, options], callTools) =>
    register(control, name ?? UNDEFINED_VALUE, options ?? UNDEFINED_VALUE, callTools),
  );
  const unregisterFunction = nativeFunction("unregister", ([name, options], callTools) => {
    unregister(control, name, options, callTools);
    return UNDEFINED_VALUE;
  });
  const getFieldStateFunction = nativeFunction("getFieldState", ([name, formState], callTools) =>
    getFieldState(control, name ?? UNDEFINED_VALUE, formState, callTools),
  );
  const setErrorFunction = nativeFunction("setError", ([name, error], callTools) => {
    setError(control, name ?? UNDEFINED_VALUE, error ?? objectValue(), callTools);
    return UNDEFINED_VALUE;
  });
  const submit = handleSubmit(control);
  const storeAccessor = (key: "formValues" | "defaultValues" | "formState"): StaticObjectEntry => ({
    kind: "property",
    key: `_${key}`,
    value: unknownValue(`${key} read through the control`),
    accessor: {
      get: nativeFunction(key, () => readStore(control, key)),
      set: null,
    },
  });
  control.control.entries.push(
    ...entriesOf({
      register: registerFunction,
      unregister: unregisterFunction,
      getFieldState: getFieldStateFunction,
      handleSubmit: submit,
      setError: setErrorFunction,
      _subscribe: nativeFunction("_subscribe", ([subscription]) =>
        subscribeState(control, toSubscription(control, subscription, false)),
      ),
      _getWatch: nativeFunction("_getWatch", ([names, defaultValue]) =>
        getWatch(control, names, defaultValue ?? UNDEFINED_VALUE, false),
      ),
    }),
    storeAccessor("formValues"),
    storeAccessor("defaultValues"),
    storeAccessor("formState"),
    {
      kind: "property",
      key: "_options",
      value: unknownValue("options read through the control"),
      accessor: {
        get: nativeFunction("_options", () => control.options),
        set: null,
      },
    },
  );
  control.methods.entries.push(
    ...entriesOf({
      control: control.control,
      subscribe: nativeFunction("subscribe", ([subscription]) => {
        control.isMounted = true;
        const proxy = toProxyFormState(propertyOf(subscription, "formState"), []);
        for (const [key, flag] of proxy) control.proxySubscribeFormState.set(key, flag);
        return subscribeState(
          control,
          toSubscription(control, subscription, true, new Map(control.proxySubscribeFormState)),
        );
      }),
      trigger: nativeFunction("trigger", ([name], callTools) => {
        invalidateErrors(control, knownString(name) ?? "", callTools, true);
        return unknownValue("promise of a validation result");
      }),
      register: registerFunction,
      handleSubmit: submit,
      watch: nativeFunction("watch", ([name, defaultValue]) =>
        isCallable(name)
          ? subscribeValueWatcher(control, {
              callback: name,
              defaultValue: defaultValue ?? UNDEFINED_VALUE,
            })
          : getWatch(control, name, defaultValue ?? UNDEFINED_VALUE, true),
      ),
      setValue: nativeFunction("setValue", ([name, value, options], callTools) => {
        setValue(
          control,
          name ?? UNDEFINED_VALUE,
          value ?? UNDEFINED_VALUE,
          options ?? UNDEFINED_VALUE,
          callTools,
        );
        return UNDEFINED_VALUE;
      }),
      getValues: nativeFunction("getValues", ([fieldNames]) => getValues(control, fieldNames)),
      reset: nativeFunction("reset", ([formValues, options], callTools) => {
        resetForm(
          control,
          isCallable(formValues)
            ? callTools.call(formValues, [readStore(control, "formValues")])
            : formValues,
          options,
          callTools,
        );
        return UNDEFINED_VALUE;
      }),
      resetField: nativeFunction("resetField", ([name, options], callTools) => {
        const fieldName = knownString(name);
        if (fieldName === null || !control.fields.has(fieldName)) return UNDEFINED_VALUE;
        const defaultValue = propertyOf(options, "defaultValue");
        const value = isUndefined(defaultValue)
          ? cloneValue(readPath(readStore(control, "defaultValues"), fieldName))
          : defaultValue;
        if (!isUndefined(defaultValue)) {
          writeStore(
            control,
            "defaultValues",
            writePath(
              readStore(control, "defaultValues"),
              toPath(fieldName),
              cloneValue(defaultValue),
            ),
            callTools,
          );
        }
        setValue(control, name ?? UNDEFINED_VALUE, value, UNDEFINED_VALUE, callTools);
        const keep = (key: string): boolean => isTruthy(propertyOf(options, key));
        const state: FormStatePayload = {};
        if (!keep("keepTouched"))
          state.touchedFields = unsetPath(readFormState(control, "touchedFields"), fieldName);
        if (!keep("keepDirty")) {
          state.dirtyFields = unsetPath(readFormState(control, "dirtyFields"), fieldName);
          state.isDirty = getDirty(control);
        }
        if (!keep("keepError"))
          state.errors = unsetPath(readFormState(control, "errors"), fieldName);
        mergeFormState(control, state, callTools);
        const formState = readStore(control, "formState");
        notifyState(
          control,
          formState.kind === "object"
            ? Object.fromEntries(
                (getKnownObjectKeys(formState) ?? []).map((key) => [
                  key,
                  getObjectProperty(formState, key),
                ]),
              )
            : {},
          callTools,
        );
        return UNDEFINED_VALUE;
      }),
      clearErrors: nativeFunction("clearErrors", ([name], callTools) => {
        clearErrors(control, name, callTools);
        return UNDEFINED_VALUE;
      }),
      unregister: unregisterFunction,
      setError: setErrorFunction,
      setFocus: nativeFunction("setFocus", () => UNDEFINED_VALUE),
      getFieldState: getFieldStateFunction,
    }),
  );
  formControls.set(control.control, control);
  return control;
};

const toSubscription = (
  control: FormControl,
  subscription: StaticValue | undefined,
  isPublic: boolean,
  proxy = toProxyFormState(propertyOf(subscription, "formState"), []),
): StateSubscription => {
  const callback = propertyOf(subscription, "callback");
  return {
    name: propertyOf(subscription, "name"),
    isExact: isTruthy(propertyOf(subscription, "exact")),
    proxy:
      isPublic || propertyOf(subscription, "formState").kind === "object"
        ? proxy
        : control.proxyFormState,
    isRoot: isTruthy(propertyOf(subscription, "reRenderRoot")),
    notify: (payload, tools) => {
      if (isCallable(callback)) tools.call(callback, [subscriptionPayload(control, payload)]);
    },
  };
};

/** `getProxyFormState`: reading a key marks it as rendered so later updates to it re-render. */
const getProxyFormState = (
  formState: StaticValue,
  control: FormControl,
  localProxy: ProxyFormState | null,
  isRoot: boolean,
): StaticValue => {
  const result = objectValue([
    {
      kind: "property",
      key: "defaultValues",
      value: readStore(control, "defaultValues"),
    },
  ]);
  if (formState.kind !== "object") return formState;
  for (const key of getKnownObjectKeys(formState) ?? []) {
    result.entries.push({
      kind: "property",
      key,
      value: unknownValue(`formState.${key} read through the proxy`),
      accessor: {
        get: nativeFunction(key, () => {
          if (control.proxyFormState.get(key) !== "all") {
            control.proxyFormState.set(key, isRoot ? "all" : true);
          }
          localProxy?.set(key, true);
          return getObjectProperty(formState, key);
        }),
        set: null,
      },
    });
  }
  return result;
};

const useStateValue = (
  tools: StubRenderTools,
  initial: StaticValue,
): [StaticValue, StaticValue] => {
  const hook = tools.call(reactApi("useState"), [initial]);
  return hook.kind === "list" && hook.items.length === 2
    ? [hook.items[0], hook.items[1]]
    : [unknownValue("state of a hook outside a render"), UNDEFINED_VALUE];
};

const useInstance = <Instance>(
  tools: StubRenderTools,
  instances: WeakMap<StaticObjectValue, Instance>,
  create: () => Instance,
): Instance => {
  const ref = tools.call(reactApi("useRef"), [UNDEFINED_VALUE]);
  if (ref.kind !== "object") return create();
  const existing = instances.get(ref);
  if (existing) return existing;
  const created = create();
  instances.set(ref, created);
  return created;
};

const useEffectHook = (
  tools: StubRenderTools,
  api: "useEffect" | "useLayoutEffect",
  deps: StaticValue[] | null,
  run: (effectTools: StubRenderTools) => StaticValue | void,
): void => {
  tools.call(reactApi(api), [
    nativeFunction("effect", (_args, effectTools) => run(effectTools) ?? UNDEFINED_VALUE),
    deps ? listValue(deps) : UNDEFINED_VALUE,
  ]);
};

const resolveControl = (
  props: StaticValue | undefined,
  tools: StubRenderTools,
): FormControl | null => {
  const explicit = propertyOf(props, "control");
  if (explicit.kind === "object") return formControls.get(explicit) ?? null;
  if (!isUndefined(explicit)) return null;
  const methods = tools.readContext(HOOK_FORM_CONTEXT);
  const fromContext = propertyOf(methods, "control");
  return fromContext.kind === "object" ? (formControls.get(fromContext) ?? null) : null;
};

const missingControl = (hook: string, props: StaticValue | undefined): StaticValue =>
  unknownValue(
    `${hook} needs a control from useForm, got ${describeValue(propertyOf(props, "control"))}`,
  );

const useForm = nativeFunction("useForm", ([propsArg], tools) => {
  if (propsArg !== undefined && propsArg.kind !== "object" && !isUndefined(propsArg)) {
    return unknownValue(`useForm options are ${describeValue(propsArg)}`);
  }
  const props = propsArg?.kind === "object" ? propsArg : objectValue();
  const [formState, updateFormState] = useStateValue(tools, initialFormState(props, true));
  const instance = useInstance(tools, formInstances, () => ({
    control: createFormControl(props),
    lastValues: null,
  }));
  const { control } = instance;
  control.options = props;
  tools.setProperty(
    control.methods,
    "formState",
    getProxyFormState(formState, control, null, true),
  );
  const controlDeps = [control.control];
  useEffectHook(tools, "useLayoutEffect", controlDeps, (effectTools) => {
    const unsubscribe = subscribeState(control, {
      name: UNDEFINED_VALUE,
      isExact: false,
      proxy: control.proxyFormState,
      isRoot: true,
      notify: (_payload, notifyTools) => {
        notifyTools.call(updateFormState, [spreadCopy(readStore(control, "formState"))]);
      },
    });
    effectTools.call(updateFormState, [withProperties(formState, { isReady: TRUE_VALUE })]);
    mergeFormState(control, { isReady: TRUE_VALUE }, effectTools);
    return unsubscribe;
  });
  const disabled = getObjectProperty(props, "disabled");
  useEffectHook(tools, "useEffect", [...controlDeps, disabled], (effectTools) => {
    if (disabled.kind === "primitive" && typeof disabled.value === "boolean") {
      notifyState(control, { disabled }, effectTools);
    }
  });
  const errors = getObjectProperty(props, "errors");
  useEffectHook(tools, "useEffect", [...controlDeps, errors], (effectTools) => {
    if (isTruthy(errors)) notifyState(control, { errors, isValid: FALSE_VALUE }, effectTools);
  });
  const shouldUnregister = getObjectProperty(props, "shouldUnregister");
  useEffectHook(tools, "useEffect", [...controlDeps, shouldUnregister], (effectTools) => {
    if (isTruthy(shouldUnregister)) {
      notifyState(
        control,
        { values: getWatch(control, undefined, UNDEFINED_VALUE, false) },
        effectTools,
      );
    }
  });
  const isDirty = propertyOf(formState, "isDirty");
  useEffectHook(tools, "useEffect", [...controlDeps, isDirty], (effectTools) => {
    if (!control.proxyFormState.get("isDirty")) return;
    const nextIsDirty = getDirty(control);
    if (compareIdentity(nextIsDirty, isDirty) !== true) {
      notifyState(control, { isDirty: nextIsDirty }, effectTools);
    }
  });
  const values = getObjectProperty(props, "values");
  useEffectHook(tools, "useEffect", [...controlDeps, values], (effectTools) => {
    if (isUndefined(values)) return;
    if (instance.lastValues && compareDeeply(values, instance.lastValues) === true) return;
    resetForm(
      control,
      values,
      withProperties(orValue(getObjectProperty(props, "resetOptions"), objectValue()), {
        keepFieldsRef: TRUE_VALUE,
      }),
      effectTools,
    );
    instance.lastValues = values;
    effectTools.call(updateFormState, [spreadCopy(formState)]);
  });
  useEffectHook(tools, "useEffect", null, (effectTools) => {
    if (!control.isMounted) {
      setValid(control, false, effectTools);
      control.isMounted = true;
    }
    if (control.shouldNotifyWatchers) {
      control.shouldNotifyWatchers = false;
      const current = readStore(control, "formState");
      notifyState(
        control,
        current.kind === "object"
          ? Object.fromEntries(
              (getKnownObjectKeys(current) ?? []).map((key) => [
                key,
                getObjectProperty(current, key),
              ]),
            )
          : {},
        effectTools,
      );
    }
  });
  return control.methods;
});

const useFormContext = nativeFunction("useFormContext", (_args, tools) =>
  tools.readContext(HOOK_FORM_CONTEXT),
);

const useWatch = nativeFunction("useWatch", ([props], tools) => {
  const control = resolveControl(props, tools);
  if (!control) return missingControl("useWatch", props);
  const name = propertyOf(props, "name");
  const disabled = propertyOf(props, "disabled");
  const isExact = isTruthy(propertyOf(props, "exact"));
  const compute = propertyOf(props, "compute");
  const instance = useInstance(tools, watchInstances, () => ({
    defaultValue: propertyOf(props, "defaultValue"),
    computedValue: null,
  }));
  const applyCompute = (value: StaticValue, computeTools: StubRenderTools): StaticValue =>
    isCallable(compute) ? computeTools.call(compute, [value]) : value;
  const [value, updateValue] = useStateValue(
    tools,
    applyCompute(getWatch(control, name, instance.defaultValue, false), tools),
  );
  useEffectHook(
    tools,
    "useLayoutEffect",
    [control.control, disabled, name, primitiveValue(isExact)],
    () =>
      subscribeState(control, {
        name,
        isExact,
        proxy: new Map([["values", true]]),
        isRoot: false,
        notify: (payload, notifyTools) => {
          if (isTruthy(disabled)) return;
          const formValues = generateWatchOutput(
            name,
            control.names,
            payload.values ?? readStore(control, "formValues"),
            false,
            instance.defaultValue,
          );
          if (!isCallable(compute)) {
            notifyTools.call(updateValue, [formValues]);
            return;
          }
          const computed = notifyTools.call(compute, [formValues]);
          if (!instance.computedValue || compareDeeply(computed, instance.computedValue) !== true) {
            notifyTools.call(updateValue, [computed]);
            instance.computedValue = computed;
          }
        },
      }),
  );
  return value;
});

const useFormState = nativeFunction("useFormState", ([props], tools) => {
  const control = resolveControl(props, tools);
  if (!control) return missingControl("useFormState", props);
  const name = propertyOf(props, "name");
  const disabled = propertyOf(props, "disabled");
  const isExact = isTruthy(propertyOf(props, "exact"));
  const [formState, updateFormState] = useStateValue(tools, readStore(control, "formState"));
  const localProxy = useInstance<ProxyFormState>(
    tools,
    localProxies,
    () => new Map(LOCAL_PROXY_KEYS.map((key) => [key, false])),
  );
  useEffectHook(tools, "useLayoutEffect", [name, disabled, primitiveValue(isExact)], () =>
    subscribeState(control, {
      name,
      isExact,
      proxy: localProxy,
      isRoot: false,
      notify: (payload, notifyTools) => {
        if (isTruthy(disabled)) return;
        notifyTools.call(updateFormState, [
          withProperties(readStore(control, "formState"), payload),
        ]);
      },
    }),
  );
  useEffectHook(tools, "useEffect", [control.control], (effectTools) => {
    if (localProxy.get("isValid")) setValid(control, true, effectTools);
  });
  return getProxyFormState(formState, control, localProxy, false);
});

const useController = nativeFunction("useController", ([props], tools) => {
  const control = resolveControl(props, tools);
  if (!control) return missingControl("useController", props);
  const nameValue = propertyOf(props, "name");
  const name = knownString(nameValue);
  const disabled = propertyOf(props, "disabled");
  const shouldUnregister = propertyOf(props, "shouldUnregister");
  const isArrayField = name !== null && control.names.array.has(getNodeParentName(name));
  const defaultValue =
    name === null
      ? unknownValue(`default of field ${describeValue(nameValue)}`)
      : readPath(
          readStore(control, "formValues"),
          name,
          readPath(readStore(control, "defaultValues"), name, propertyOf(props, "defaultValue")),
        );
  const value = tools.call(useWatch, [
    objectFromRecord({
      control: control.control,
      name: nameValue,
      defaultValue,
      exact: TRUE_VALUE,
    }),
  ]);
  const formState = tools.call(useFormState, [
    objectFromRecord({
      control: control.control,
      name: nameValue,
      exact: TRUE_VALUE,
    }),
  ]);
  const isDisabledBoolean = disabled.kind === "primitive" && typeof disabled.value === "boolean";
  const rules = spreadCopy(propertyOf(props, "rules"));
  register(
    control,
    nameValue,
    withProperties(rules, {
      value,
      ...(isDisabledBoolean ? { disabled } : {}),
    }),
    tools,
  );
  const readFieldState = (key: string, fieldTools: StubRenderTools): StaticValue =>
    name === null
      ? unknownValue(`${key} of field ${describeValue(nameValue)}`)
      : readPath(readProperty(formState, key, fieldTools), name);
  const fieldStateEntry = (key: string, source: string, isBoolean: boolean): StaticObjectEntry => ({
    kind: "property",
    key,
    value: unknownValue(`fieldState.${key}`),
    accessor: {
      get: nativeFunction(key, (_args, fieldTools) => {
        const read = readFieldState(source, fieldTools);
        return isBoolean ? booleanValue(getTruthiness(read), `whether ${key} for "${name}"`) : read;
      }),
      set: null,
    },
  });
  const fieldState = objectValue([
    fieldStateEntry("invalid", "errors", true),
    fieldStateEntry("isDirty", "dirtyFields", true),
    fieldStateEntry("isTouched", "touchedFields", true),
    fieldStateEntry("isValidating", "validatingFields", true),
    fieldStateEntry("error", "errors", false),
  ]);
  const formDisabled = readProperty(formState, "disabled", tools);
  const onChange = handleChange(control);
  const field = objectFromRecord({
    name: nameValue,
    value,
    ...(isDisabledBoolean || isTruthy(formDisabled)
      ? { disabled: orValue(formDisabled, disabled) }
      : {}),
    onChange: nativeFunction("onChange", ([event], changeTools) =>
      changeTools.call(onChange, [
        objectFromRecord({
          target: objectFromRecord({
            value: eventValue(event),
            name: nameValue,
          }),
          type: primitiveValue("change"),
        }),
      ]),
    ),
    onBlur: nativeFunction("onBlur", (_args, blurTools) =>
      blurTools.call(onChange, [
        objectFromRecord({
          target: objectFromRecord({
            value:
              name === null ? UNDEFINED_VALUE : readPath(readStore(control, "formValues"), name),
            name: nameValue,
          }),
          type: primitiveValue("blur"),
        }),
      ]),
    ),
    ref: nativeFunction("ref", () => UNDEFINED_VALUE),
  });
  useEffectHook(
    tools,
    "useEffect",
    [nameValue, control.control, primitiveValue(isArrayField), shouldUnregister],
    (effectTools) => {
      const shouldUnregisterField =
        isTruthy(getObjectProperty(control.options, "shouldUnregister")) ||
        isTruthy(shouldUnregister);
      register(
        control,
        nameValue,
        withProperties(rules, isDisabledBoolean ? { disabled } : {}),
        effectTools,
      );
      if (shouldUnregisterField && name !== null) {
        const optionDefault = cloneValue(
          readPath(getObjectProperty(control.options, "defaultValues"), name),
        );
        writeStore(
          control,
          "defaultValues",
          writePath(readStore(control, "defaultValues"), toPath(name), optionDefault),
          effectTools,
        );
        if (isUndefined(readPath(readStore(control, "formValues"), name))) {
          writeStore(
            control,
            "formValues",
            writePath(readStore(control, "formValues"), toPath(name), optionDefault),
            effectTools,
          );
        }
      }
      if (!isArrayField) register(control, nameValue, UNDEFINED_VALUE, effectTools);
      return nativeFunction("cleanup", (_args, cleanupTools) => {
        if (shouldUnregisterField) unregister(control, nameValue, UNDEFINED_VALUE, cleanupTools);
        return UNDEFINED_VALUE;
      });
    },
  );
  useEffectHook(tools, "useEffect", [disabled, nameValue, control.control], () => {
    if (name !== null) setDisabledField(control, name, disabled);
  });
  return objectFromRecord({ field, formState, fieldState });
});

const eventValue = (event: StaticValue | undefined): StaticValue => {
  if (event === undefined) return UNDEFINED_VALUE;
  const target = propertyOf(event, "target");
  if (target.kind !== "object") return event;
  const checked = getObjectProperty(target, "checked");
  return knownString(getObjectProperty(target, "type")) === "checkbox"
    ? checked
    : getObjectProperty(target, "value");
};

const CONTROLLER_STUB: StubComponent = {
  displayName: "Controller",
  render: (props, tools) => {
    const render = getObjectProperty(props, "render");
    const controller = tools.call(useController, [props]);
    return isCallable(render)
      ? tools.call(render, [controller])
      : unknownValue(`Controller render prop is ${describeValue(render)}`);
  },
};

const FORM_PROVIDER_STUB: StubComponent = {
  displayName: "FormProvider",
  render: (props) =>
    element(
      {
        kind: "context-provider",
        context: HOOK_FORM_CONTEXT,
        displayName: null,
      },
      objectFromRecord({
        value: omitProps(props, new Set(["children"])),
        children: getObjectProperty(props, "children"),
      }),
    ),
};

const generateId = (): StaticValue =>
  unknownPrimitiveValue("string", "field array id from crypto.randomUUID");

const useFieldArray = nativeFunction("useFieldArray", ([props], tools) => {
  const control = resolveControl(props, tools);
  if (!control) return missingControl("useFieldArray", props);
  const nameValue = propertyOf(props, "name");
  const name = knownString(nameValue);
  if (name === null) return unknownValue(`useFieldArray on ${describeValue(nameValue)}`);
  const keyName = knownString(propertyOf(props, "keyName")) ?? "id";
  const shouldUnregister = propertyOf(props, "shouldUnregister");
  const [fields, setFields] = useStateValue(tools, getFieldArray(control, name));
  const instance = useInstance(tools, fieldArrayInstances, () => ({
    ids: (fields.kind === "list" ? fields.items : []).map(generateId),
  }));
  control.names.array.add(name);
  const rules = propertyOf(props, "rules");
  useInstance(tools, ruleRegistrations, () => {
    if (isTruthy(rules)) register(control, nameValue, rules, tools);
    return true;
  });
  useEffectHook(tools, "useLayoutEffect", [control.control, nameValue], () => {
    const subscription: ArraySubscription = {
      notify: (payload, notifyTools) => {
        const fieldArrayName = payload.name;
        if (fieldArrayName !== undefined && getTruthiness(fieldArrayName) !== false) {
          const signal = knownString(fieldArrayName);
          if (signal !== null && signal !== name) return;
        }
        const fieldValues = readPath(payload.values ?? UNDEFINED_VALUE, name);
        if (fieldValues.kind === "list") {
          notifyTools.call(setFields, [fieldValues]);
          instance.ids = fieldValues.items.map(generateId);
        } else if (fieldValues.kind !== "primitive") {
          notifyTools.call(setFields, [unknownValue(`field array "${name}" after an update`)]);
        }
      },
    };
    control.arraySubscriptions.add(subscription);
    return nativeFunction("unsubscribe", () => {
      control.arraySubscriptions.delete(subscription);
      return UNDEFINED_VALUE;
    });
  });
  const updateValues = (updated: StaticValue[], updateTools: StubRenderTools): void => {
    writeStore(
      control,
      "formValues",
      writePath(readStore(control, "formValues"), toPath(name), listValue(updated)),
      updateTools,
    );
    updateTools.call(setFields, [listValue(updated)]);
    notifyState(
      control,
      {
        name: nameValue,
        isDirty: getDirty(control),
        dirtyFields: isProxied(control, "dirtyFields")
          ? unknownValue("dirty fields after a field array change")
          : readFormState(control, "dirtyFields"),
        errors: readFormState(control, "errors"),
        isValid: readFormState(control, "isValid"),
      },
      updateTools,
    );
    notifyState(
      control,
      { name: nameValue, values: cloneValue(readStore(control, "formValues")) },
      updateTools,
    );
    setValid(control, false, updateTools);
  };
  const currentItems = (): StaticValue[] | null => {
    const current = getFieldArray(control, name);
    return current.kind === "list" ? current.items : null;
  };
  const arrayMethod = (
    methodName: string,
    apply: (items: StaticValue[], args: StaticValue[]) => StaticValue[] | null,
  ): StaticValue =>
    nativeFunction(methodName, (args, methodTools) => {
      const items = currentItems();
      const updated = items ? apply(items, args) : null;
      if (updated === null) {
        writeStore(
          control,
          "formValues",
          writePath(
            readStore(control, "formValues"),
            toPath(name),
            unknownValue(`field array "${name}" after ${methodName}`),
          ),
          methodTools,
        );
        methodTools.call(setFields, [unknownValue(`field array "${name}" after ${methodName}`)]);
        return UNDEFINED_VALUE;
      }
      instance.ids = updated.map(generateId);
      updateValues(updated, methodTools);
      return UNDEFINED_VALUE;
    });
  const toItems = (value: StaticValue | undefined): StaticValue[] | null => {
    if (value === undefined) return [];
    if (value.kind === "list")
      return value.items.some(isIndefinite) ? null : value.items.map(cloneValue);
    return [cloneValue(value)];
  };
  const knownIndex = (value: StaticValue | undefined): number | null =>
    value?.kind === "primitive" && typeof value.value === "number" ? value.value : null;
  useEffectHook(
    tools,
    "useEffect",
    [nameValue, control.control, primitiveValue(keyName), shouldUnregister],
    (effectTools) => {
      if (getTruthiness(readPath(readStore(control, "formValues"), name)) === false) {
        writeStore(
          control,
          "formValues",
          writePath(readStore(control, "formValues"), toPath(name), listValue([])),
          effectTools,
        );
      }
    },
  );
  return objectFromRecord({
    swap: arrayMethod("swap", (items, [from, to]) => {
      const fromIndex = knownIndex(from);
      const toIndex = knownIndex(to);
      if (fromIndex === null || toIndex === null) return null;
      const updated = [...items];
      [updated[fromIndex], updated[toIndex]] = [
        updated[toIndex] ?? UNDEFINED_VALUE,
        updated[fromIndex] ?? UNDEFINED_VALUE,
      ];
      return updated;
    }),
    move: arrayMethod("move", (items, [from, to]) => {
      const fromIndex = knownIndex(from);
      const toIndex = knownIndex(to);
      if (fromIndex === null || toIndex === null) return null;
      const updated = [...items];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved ?? UNDEFINED_VALUE);
      return updated;
    }),
    prepend: arrayMethod("prepend", (items, [value]) => {
      const added = toItems(value);
      return added && [...added, ...items];
    }),
    append: arrayMethod("append", (items, [value]) => {
      const added = toItems(value);
      return added && [...items, ...added];
    }),
    remove: arrayMethod("remove", (items, [index]) => {
      if (index === undefined || isUndefined(index)) return [];
      const indexes = index.kind === "list" ? index.items.map(knownIndex) : [knownIndex(index)];
      return indexes.includes(null)
        ? null
        : items.filter((_item, position) => !indexes.includes(position));
    }),
    insert: arrayMethod("insert", (items, [index, value]) => {
      const position = knownIndex(index);
      const added = toItems(value);
      if (position === null || added === null) return null;
      return [...items.slice(0, position), ...added, ...items.slice(position)];
    }),
    update: arrayMethod("update", (items, [index, value]) => {
      const position = knownIndex(index);
      if (position === null) return null;
      const updated = [...items];
      updated[position] = cloneValue(value ?? UNDEFINED_VALUE);
      return updated;
    }),
    replace: arrayMethod("replace", (_items, [value]) => toItems(value)),
    fields:
      fields.kind === "list"
        ? listValue(
            fields.items.map((field, index) =>
              withProperties(spreadCopy(field), {
                [keyName]: instance.ids[index] ?? generateId(),
              }),
            ),
          )
        : fields,
  });
});

export const reactHookFormValue: ExternalValueProvider = (specifier, importedName) => {
  if (!REACT_HOOK_FORM_PACKAGES.includes(specifier)) return null;
  switch (importedName) {
    case "useForm":
      return useForm;
    case "useFormContext":
      return useFormContext;
    case "useWatch":
      return useWatch;
    case "useFormState":
      return useFormState;
    case "useController":
      return useController;
    case "useFieldArray":
      return useFieldArray;
    case "Controller":
      return stubValue(CONTROLLER_STUB);
    case "FormProvider":
      return stubValue(FORM_PROVIDER_STUB);
    case "get":
      return nativeFunction("get", ([object, path, defaultValue]) => {
        const name = knownString(path);
        if (object === undefined || name === null) return defaultValue ?? UNDEFINED_VALUE;
        return readPath(object, name, defaultValue);
      });
    default:
      return null;
  }
};
