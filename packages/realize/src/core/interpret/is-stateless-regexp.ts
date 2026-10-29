import type { SymbolicValue } from "../types";

const STATEFUL_FLAGS = /[gy]/;

export const isStatelessRegExp = (
  value: SymbolicValue,
): value is Extract<SymbolicValue, { kind: "RegExp" }> =>
  value.kind === "RegExp" && !STATEFUL_FLAGS.test(value.flags);
