import {
  FALSE_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  listValue,
  mapValue,
  objectValue,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type {
  ExternalValueProvider,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticSymbolValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

// Immer hands the recipe a revocable Proxy of the base and finalizes whatever the
// proxy recorded, which no static object can stand in for. The model gives the
// recipe a copy of the draftable graph and, like Immer's finalization, hands back
// the base object for every subtree the recipe left unchanged.

export const IMMER_PACKAGES = ["immer"];

const NOTHING: StaticSymbolValue = { kind: "symbol", key: "immer-nothing" };
const IMMERABLE: StaticSymbolValue = { kind: "symbol", key: "immer-draftable" };

type Draftable = StaticObjectValue | StaticListValue;

const draftBases = new WeakMap<Draftable, Draftable>();

const isUndefined = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === undefined;

const isCallable = (value: StaticValue | undefined): value is StaticValue =>
  value?.kind === "function" || value?.kind === "native-function";

/** Plain objects and arrays; class instances and prototype-carrying objects are shared, as Immer leaves them. */
const isDraftable = (value: StaticValue): value is Draftable =>
  value.kind === "list" ||
  (value.kind === "object" &&
    value.constructedBy === undefined &&
    value.prototype === undefined &&
    !value.hasNullPrototype);

const createDraft = (base: StaticValue, drafts: Map<Draftable, Draftable>): StaticValue => {
  if (!isDraftable(base)) return base;
  const existing = drafts.get(base);
  if (existing) return existing;
  if (base.kind === "list") {
    const draft = listValue([]);
    drafts.set(base, draft);
    draftBases.set(draft, base);
    draft.items = base.items.map((item) => createDraft(item, drafts));
    if (base.properties) draft.properties = base.properties;
    return draft;
  }
  const draft = objectValue();
  drafts.set(base, draft);
  draftBases.set(draft, base);
  draft.entries = base.entries.map((entry): StaticObjectEntry =>
    entry.kind === "property"
      ? { ...entry, value: createDraft(entry.value, drafts) }
      : { kind: "spread", value: createDraft(entry.value, drafts) },
  );
  return draft;
};

const isSameFinalizedValue = (left: StaticValue, right: StaticValue): boolean =>
  left === right ||
  (left.kind === "primitive" && right.kind === "primitive" && left.value === right.value);

const isSameEntry = (left: StaticObjectEntry, right: StaticObjectEntry): boolean =>
  left.kind === right.kind &&
  (left.kind !== "property" || right.kind !== "property" || left.key === right.key) &&
  isSameFinalizedValue(left.value, right.value);

/** The base wherever the draft still equals it, otherwise the draft with its children finalized. */
const finalize = (draft: StaticValue, drafts: Map<Draftable, Draftable>): StaticValue => {
  if (!isDraftable(draft)) return draft;
  const base = draftBases.get(draft);
  if (!base || !drafts.has(base)) return draft;
  if (draft.kind === "list") {
    draft.items = draft.items.map((item) => finalize(item, drafts));
    return base.kind === "list" &&
      draft.items.length === base.items.length &&
      draft.items.every((item, index) => isSameFinalizedValue(item, base.items[index])) &&
      draft.properties === base.properties
      ? base
      : draft;
  }
  draft.entries = draft.entries.map((entry) => ({
    ...entry,
    value: finalize(entry.value, drafts),
  }));
  return base.kind === "object" &&
    draft.entries.length === base.entries.length &&
    draft.entries.every((entry, index) => isSameEntry(entry, base.entries[index]))
    ? base
    : draft;
};

const produceFrom = (
  base: StaticValue,
  recipe: StaticValue,
  tools: StubRenderTools,
): StaticValue => {
  if (!isDraftable(base)) {
    const returned = tools.call(recipe, [base]);
    if (isUndefined(returned)) return base;
    return returned === NOTHING ? UNDEFINED_VALUE : returned;
  }
  const drafts = new Map<Draftable, Draftable>();
  const draft = createDraft(base, drafts);
  const returned = tools.call(recipe, [draft]);
  if (isUndefined(returned) || returned === draft) return finalize(draft, drafts);
  if (returned === NOTHING) return UNDEFINED_VALUE;
  return returned.kind === "unknown"
    ? unknownValue("state returned by an Immer recipe")
    : finalize(returned, drafts);
};

const produce = ([base, recipe, ...rest]: StaticValue[], tools: StubRenderTools): StaticValue => {
  if (base === undefined) return UNDEFINED_VALUE;
  if (isCallable(base) && !isCallable(recipe)) {
    const curriedRecipe = base;
    const defaultBase = recipe;
    return nativeFunction("produce", ([state = UNDEFINED_VALUE, ...recipeArgs], curriedTools) =>
      produceFrom(
        isUndefined(state) ? (defaultBase ?? UNDEFINED_VALUE) : state,
        nativeFunction("recipe", ([draft = UNDEFINED_VALUE]) =>
          curriedTools.call(curriedRecipe, [draft, ...recipeArgs]),
        ),
        curriedTools,
      ),
    );
  }
  if (!isCallable(recipe)) return unknownValue("Immer recipe that is not a function");
  if (rest.length > 0 && !isUndefined(rest[0]))
    return unknownValue("state produced with a patch listener");
  return mapValue(base, (alternative) => produceFrom(alternative, recipe, tools));
};

const noop = (): StaticValue => UNDEFINED_VALUE;

const identity = ([value]: StaticValue[]): StaticValue => value ?? UNDEFINED_VALUE;

export const immerValue: ExternalValueProvider = (specifier, importedName) => {
  if (!IMMER_PACKAGES.includes(specifier)) return null;
  switch (importedName) {
    case "default":
    case "produce":
      return nativeFunction("produce", produce);
    case "castDraft":
    case "castImmutable":
    case "freeze":
    case "current":
      return nativeFunction(importedName, identity);
    case "original":
      return nativeFunction(importedName, ([draft]) =>
        draft && isDraftable(draft) ? (draftBases.get(draft) ?? UNDEFINED_VALUE) : UNDEFINED_VALUE,
      );
    case "isDraft":
      return nativeFunction(importedName, () => FALSE_VALUE);
    case "isDraftable":
      return nativeFunction(importedName, ([value]) =>
        value && isDraftable(value) ? TRUE_VALUE : FALSE_VALUE,
      );
    case "nothing":
      return NOTHING;
    case "immerable":
      return IMMERABLE;
    case "enableMapSet":
    case "enablePatches":
    case "enableES5":
    case "enableAllPlugins":
    case "setAutoFreeze":
    case "setUseProxies":
    case "setUseStrictShallowCopy":
      return nativeFunction(importedName, noop);
    default:
      return null;
  }
};
