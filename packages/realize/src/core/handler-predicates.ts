import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { Binding, Handler, StateUpdate, SymbolicValue } from "./types";

export const EVENT_ARGUMENT: SymbolicValue = {
  kind: "Unknown",
  reason: "event",
  loc: GeneratedSource,
};

export const isEffectHandler = (handler: Handler): boolean => handler.trigger.kind === "Effect";

export const isRenderHandler = (handler: Handler): boolean => handler.trigger.kind === "Render";

export const getBindingUpdates = (handlers: Handler[], binding: Binding): StateUpdate[] =>
  handlers
    .flatMap((handler) => handler.updates)
    .filter((update) => update.binding.id === binding.id);
