import type { StaticValue } from "../types.js";
import { getKeyIdentity } from "./collections.js";
import { regExpToString } from "./values.js";

interface ScalarMemo {
  byPrimitive: Map<unknown, ScalarMemo>;
  byObject: WeakMap<object, ScalarMemo>;
  result: StaticValue | null;
}

const createScalarMemo = (): ScalarMemo => ({
  byPrimitive: new Map(),
  byObject: new WeakMap(),
  result: null,
});

const nativeOperationMemos = new WeakMap<object, ScalarMemo>();
const namedOperationMemos = new Map<string, ScalarMemo>();

const getOperationMemo = (operation: object | string): ScalarMemo => {
  if (typeof operation === "string") {
    const named = namedOperationMemos.get(operation) ?? createScalarMemo();
    namedOperationMemos.set(operation, named);
    return named;
  }
  const native = nativeOperationMemos.get(operation) ?? createScalarMemo();
  nativeOperationMemos.set(operation, native);
  return native;
};

const isScalar = (value: StaticValue): boolean =>
  value.kind === "primitive" ||
  value.kind === "unknown-primitive" ||
  value.kind === "regexp" ||
  (value.kind === "external" && value.origin === "derived");

const getScalarIdentity = (value: StaticValue): unknown =>
  value.kind === "regexp" ? regExpToString(value) : getKeyIdentity(value);

const getNextMemo = (memo: ScalarMemo, identity: unknown): ScalarMemo => {
  if (typeof identity === "object" && identity !== null) {
    const next = memo.byObject.get(identity) ?? createScalarMemo();
    memo.byObject.set(identity, next);
    return next;
  }
  const next = memo.byPrimitive.get(identity) ?? createScalarMemo();
  memo.byPrimitive.set(identity, next);
  return next;
};

/**
 * The result of the pure `operation` on `scalars`, computed once per distinct operand
 * identities: each scalar stands for one runtime value, so a dynamic string hashed or
 * normalized twice is one result and stays one `Map` key across renders. Null when an
 * operand is not a scalar.
 */
export const memoizeScalarOperation = (
  operation: object | string,
  scalars: StaticValue[],
  compute: () => StaticValue,
): StaticValue | null => {
  if (!scalars.every(isScalar)) return null;
  const memo = scalars.reduce(
    (current, scalar) => getNextMemo(current, getScalarIdentity(scalar)),
    getOperationMemo(operation),
  );
  memo.result ??= compute();
  return memo.result;
};
