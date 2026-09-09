import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type { EvaluationContext } from "./context.js";
import { createDomExceptionValue } from "./errors.js";
import type { Interpreter } from "./interpreter.js";
import { structuredCloneValue } from "./structured-clone.js";
import {
  NULL_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  getObjectProperty,
  listValue,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

/** Stands in the listener list where `onmessage` was first assigned, so the handler fires in registration order. */
const HANDLER_SLOT = nativeFunction("onmessage", () => UNDEFINED_VALUE);

interface BroadcastChannelRecord {
  name: string;
  value: StaticObjectValue;
  listeners: StaticValue[];
  handler: StaticValue;
  isClosed: boolean;
  isEscaped: boolean;
}

const channelRecords = new WeakMap<Interpreter, BroadcastChannelRecord[]>();

const isMessageEventType = (type: StaticValue | undefined): boolean =>
  type?.kind === "primitive" && type.value === "message";

const isCallable = (value: StaticValue): boolean => value.kind !== "primitive";

const getHandlers = (record: BroadcastChannelRecord): StaticValue[] =>
  record.listeners.map((listener) => (listener === HANDLER_SLOT ? record.handler : listener));

/**
 * `new BroadcastChannel(name)`: a message posted on one channel reaches every
 * other open channel of that name in the same origin as a later task, and no
 * other browsing context exists in the captured page, so a `message` listener
 * runs only when the analysis sees such a post. A channel handed to code the
 * evaluator does not follow may be posted to at any time, so the listeners its
 * peers hold or later register become uncertain.
 */
export const createBroadcastChannel = (
  interpreter: Interpreter,
  name: StaticValue | undefined,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (name === undefined || name.kind !== "primitive")
    return unknownValue("new BroadcastChannel with a dynamic name", location);
  let records = channelRecords.get(interpreter);
  if (!records) {
    records = [];
    channelRecords.set(interpreter, records);
  }
  const record: BroadcastChannelRecord = {
    name: String(name.value),
    value: objectFromRecord({ name: primitiveValue(String(name.value)) }),
    listeners: [],
    handler: NULL_VALUE,
    isClosed: false,
    isEscaped: false,
  };
  records.push(record);
  const peers = (): BroadcastChannelRecord[] =>
    records.filter((peer) => peer !== record && peer.name === record.name && !peer.isClosed);
  const register = (listener: StaticValue): void => {
    if (peers().some((peer) => peer.isEscaped)) interpreter.markEscaped(listener);
  };
  const messageEvent = (target: BroadcastChannelRecord, data: StaticValue): StaticValue =>
    objectFromRecord({
      type: primitiveValue("message"),
      data,
      origin:
        interpreter.origin === null
          ? unknownPrimitiveValue("string", "origin of the page")
          : primitiveValue(interpreter.origin),
      lastEventId: primitiveValue(""),
      ports: listValue([]),
      source: NULL_VALUE,
      target: target.value,
      currentTarget: target.value,
    });
  const postMessage: StaticValue = {
    kind: "native-function",
    name: "postMessage",
    call: ([message]) => {
      if (record.isClosed) {
        return thrownValue(
          "postMessage on a closed BroadcastChannel",
          createDomExceptionValue(
            "Failed to execute 'postMessage' on 'BroadcastChannel': Channel is closed",
            "InvalidStateError",
            location,
          ),
          location,
        );
      }
      const data =
        (message ? structuredCloneValue(message) : null) ??
        unknownValue("structured clone of a dynamic message", location);
      const isDeferred = interpreter.timers.isDeferred;
      for (const peer of peers()) {
        interpreter.timers.enqueue(() => {
          if (peer.isClosed) return;
          for (const handler of getHandlers(peer)) {
            const args = [messageEvent(peer, data)];
            if (isDeferred) interpreter.callDeferred(handler, args, context, location);
            else interpreter.callValue(handler, args, context, location);
          }
        });
      }
      return UNDEFINED_VALUE;
    },
    onEscape: () => {
      record.isEscaped = true;
      for (const peer of peers()) {
        for (const handler of getHandlers(peer)) interpreter.markEscaped(handler);
      }
    },
  };
  record.value.entries.push(
    {
      kind: "property",
      key: "onmessage",
      value: unknownValue("onmessage handler of a BroadcastChannel", location),
      accessor: {
        get: nativeFunction("onmessage", () => record.handler),
        set: nativeFunction("onmessage", ([handler = NULL_VALUE]) => {
          const slot = record.listeners.indexOf(HANDLER_SLOT);
          if (isCallable(handler) && slot === -1) record.listeners.push(HANDLER_SLOT);
          if (!isCallable(handler) && slot !== -1) record.listeners.splice(slot, 1);
          record.handler = isCallable(handler) ? handler : NULL_VALUE;
          if (isCallable(handler)) register(handler);
          return UNDEFINED_VALUE;
        }),
      },
    },
    {
      kind: "property",
      key: "addEventListener",
      value: nativeFunction("addEventListener", ([type, listener]) => {
        if (listener && isMessageEventType(type) && !record.listeners.includes(listener)) {
          record.listeners.push(listener);
          register(listener);
        }
        return UNDEFINED_VALUE;
      }),
    },
    {
      kind: "property",
      key: "removeEventListener",
      value: nativeFunction("removeEventListener", ([type, listener]) => {
        const index = listener && isMessageEventType(type) ? record.listeners.indexOf(listener) : -1;
        if (index !== -1) record.listeners.splice(index, 1);
        return UNDEFINED_VALUE;
      }),
    },
    {
      kind: "property",
      key: "dispatchEvent",
      value: nativeFunction("dispatchEvent", ([event], tools) => {
        const type = event?.kind === "object" ? getObjectProperty(event, "type") : undefined;
        if (event && isMessageEventType(type)) {
          for (const handler of getHandlers(record)) tools.call(handler, [event]);
        }
        return TRUE_VALUE;
      }),
    },
    { kind: "property", key: "postMessage", value: postMessage },
    {
      kind: "property",
      key: "close",
      value: nativeFunction("close", () => {
        record.isClosed = true;
        return UNDEFINED_VALUE;
      }),
    },
  );
  return record.value;
};
