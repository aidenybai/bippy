import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { Handler, SymbolicValue } from "../types";

export const EVENT_ARGUMENT: SymbolicValue = {
  kind: "Unknown",
  reason: "event",
  loc: GeneratedSource,
};

export const isEffectHandler = (handler: Handler): boolean => handler.trigger.kind === "Effect";
