import type { ContextDefinition, StaticValue } from "./values.js";
import { unknown } from "./values.js";

/** Values provided by enclosing `<Context value>` fibers, keyed by context identity. */
export type ProvidedContexts = ReadonlyMap<string, StaticValue>;

export const EMPTY_CONTEXTS: ProvidedContexts = new Map();

export const getContextKey = (definition: ContextDefinition): string =>
  `${definition.module.filePath}@${definition.span.start}`;

export const provideContext = (
  contexts: ProvidedContexts,
  definition: ContextDefinition,
  value: StaticValue,
): ProvidedContexts => new Map(contexts).set(getContextKey(definition), value);

/**
 * What `useContext(Context)` / `use(Context)` / `<Context.Consumer>` observe:
 * the nearest provided value, else the default. Anything that is not a
 * context object stays unknown.
 */
export const readContext = (contexts: ProvidedContexts, target: StaticValue): StaticValue => {
  if (target.kind !== "component" || target.definition.kind !== "context") {
    return unknown("context value");
  }
  return contexts.get(getContextKey(target.definition)) ?? target.definition.defaultValue;
};
