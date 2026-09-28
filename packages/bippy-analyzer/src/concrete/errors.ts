import type { Value } from "../../engine/dist/declaration/index.mjs";

export class ConcreteRuntimeError extends Error {
  override name = "ConcreteRuntimeError";
}

export class ConcreteGuestError extends Error {
  override name = "ConcreteGuestError";

  constructor(readonly value: Value) {
    super("Guest JavaScript threw", { cause: value });
  }
}
