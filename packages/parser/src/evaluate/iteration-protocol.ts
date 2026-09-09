import type { SourceLocation, StaticValue } from "../types.js";
import { getCollectionItems } from "./collections.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { getThrowCertainty } from "./thrown.js";
import {
  getSymbolPropertyKey,
  getTruthiness,
  isCallable,
  listValue,
  optionalValue,
  unknownValue,
} from "./values.js";

const ITERATOR_METHOD_KEY = getSymbolPropertyKey({ kind: "symbol", key: "Symbol.iterator" });

/** Upper bound on `next()` calls before the remaining results become uncertain. */
const MAX_PROTOCOL_STEPS = 256;

const remainingResults = (location: SourceLocation | null): StaticValue => ({
  kind: "repeat",
  item: unknownValue("results of an iterator whose end is not statically known", location),
  location,
});

/**
 * Drains a program-defined iterable the way `for..of` does: `[Symbol.iterator]()`
 * then `next()` until `done`. Null when the value does not implement the
 * protocol with functions the analysis can run.
 */
const getProtocolItems = (
  interpreter: Interpreter,
  iterable: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  if (iterable.kind !== "object") return null;
  const method = interpreter.getProperty(iterable, ITERATOR_METHOD_KEY, context, location);
  if (!isCallable(method)) return null;
  const iterator = interpreter.callValue(method, [], context, location, { thisValue: iterable });
  if (iterator.kind !== "object") return null;
  const items: StaticValue[] = [];
  for (let step = 0; step < MAX_PROTOCOL_STEPS; step++) {
    const next = interpreter.getProperty(iterator, "next", context, location);
    if (!isCallable(next)) return null;
    const result = interpreter.callValue(next, [], context, location, { thisValue: iterator });
    if (result.kind !== "object" || getThrowCertainty(result) !== "never") return null;
    const isDone = getTruthiness(interpreter.getProperty(result, "done", context, location));
    if (isDone === true) return listValue(items);
    const value = interpreter.getProperty(result, "value", context, location);
    if (isDone === false) {
      items.push(value);
      continue;
    }
    items.push(
      optionalValue(value, "iterator may already be done", location),
      remainingResults(location),
    );
    return listValue(items);
  }
  items.push(remainingResults(location));
  return listValue(items);
};

/** What iterating `value` yields: collection entries, generator yields, or a program-defined iterator's results; `value` itself otherwise. */
export const getIterableItems = (
  interpreter: Interpreter,
  value: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue =>
  getCollectionItems(value) ?? getProtocolItems(interpreter, value, context, location) ?? value;
