import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import { nativeFunction } from "./stubs.js";
import type { Interpreter } from "./interpreter.js";
import {
  FALSE_VALUE,
  NULL_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  getObjectProperty,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const abortWitnesses = new WeakMap<StaticObjectValue, AbortController | AbortSignal>();

export const getAbortWitness = (value: StaticObjectValue): AbortController | AbortSignal | null =>
  abortWitnesses.get(value) ?? null;

const isAbortEventType = (type: StaticValue | undefined): boolean =>
  type?.kind === "primitive" && type.value === "abort";

const isAborted = (signal: StaticObjectValue): boolean =>
  getObjectProperty(signal, "aborted") === TRUE_VALUE;

/**
 * `new AbortController()`: the signal aborts only when its controller's `abort`
 * runs; a controller handed to code the evaluator does not follow may be aborted
 * at any time, so its signal state and listeners become uncertain.
 */
export const createAbortController = (
  interpreter: Interpreter,
  location: SourceLocation | null,
): StaticObjectValue => {
  const listeners: StaticValue[] = [];
  const signal = objectFromRecord({
    aborted: FALSE_VALUE,
    reason: UNDEFINED_VALUE,
    onabort: NULL_VALUE,
  });
  const abortEvent = (): StaticValue =>
    objectFromRecord({ type: primitiveValue("abort"), target: signal });
  signal.entries.push(
    {
      kind: "property",
      key: "addEventListener",
      value: nativeFunction("addEventListener", ([type, listener]) => {
        if (listener && isAbortEventType(type) && !listeners.includes(listener))
          listeners.push(listener);
        return UNDEFINED_VALUE;
      }),
    },
    {
      kind: "property",
      key: "removeEventListener",
      value: nativeFunction("removeEventListener", ([type, listener]) => {
        const index = listener && isAbortEventType(type) ? listeners.indexOf(listener) : -1;
        if (index !== -1) listeners.splice(index, 1);
        return UNDEFINED_VALUE;
      }),
    },
    {
      kind: "property",
      key: "throwIfAborted",
      value: nativeFunction("throwIfAborted", () =>
        isAborted(signal)
          ? thrownValue("aborted signal", getObjectProperty(signal, "reason"), location)
          : UNDEFINED_VALUE,
      ),
    },
  );
  const abort: StaticValue = {
    kind: "native-function",
    name: "abort",
    call: ([reason], tools) => {
      if (isAborted(signal)) return UNDEFINED_VALUE;
      tools.setProperty(signal, "aborted", TRUE_VALUE);
      tools.setProperty(
        signal,
        "reason",
        reason ?? unknownValue("AbortError DOMException of abort()", location),
      );
      for (const listener of listeners.splice(0)) tools.call(listener, [abortEvent()]);
      const onabort = getObjectProperty(signal, "onabort");
      if (onabort.kind !== "primitive") tools.call(onabort, [abortEvent()]);
      return UNDEFINED_VALUE;
    },
    onEscape: () => {
      if (isAborted(signal)) return;
      const reason = "signal of an escaped AbortController";
      interpreter.assignOwnProperty(signal, "aborted", unknownPrimitiveValue("boolean", reason));
      interpreter.assignOwnProperty(signal, "reason", unknownValue(reason, location));
      for (const listener of listeners.splice(0)) interpreter.markEscaped(listener);
      interpreter.markEscaped(getObjectProperty(signal, "onabort"));
    },
  };
  const controller = objectFromRecord({ signal, abort });
  const witness = new AbortController();
  abortWitnesses.set(controller, witness);
  abortWitnesses.set(signal, witness.signal);
  return controller;
};
