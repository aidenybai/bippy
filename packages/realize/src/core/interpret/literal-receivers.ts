import type { CollectionValue, PrimitiveValue, SymbolicValue } from "../types";

type LiteralCollection = Set<PrimitiveValue> | Map<PrimitiveValue, PrimitiveValue>;

const COLLECTION_READS = new Set(["has", "get"]);

const COLLECTION_WRITES = new Set(["add", "set", "delete", "clear"]);

const toPrimitiveResult = (result: unknown): PrimitiveValue | null =>
  result === undefined ||
  typeof result === "string" ||
  typeof result === "number" ||
  typeof result === "boolean"
    ? result
    : null;

const applyMethod = (
  receiver: object,
  methodName: string,
  argumentValues: PrimitiveValue[],
): PrimitiveValue | null => {
  const method: unknown = Reflect.get(receiver, methodName);
  return typeof method === "function"
    ? toPrimitiveResult(Reflect.apply(method, receiver, argumentValues))
    : null;
};

const getPrimitives = (values: SymbolicValue[]): PrimitiveValue[] | null => {
  const primitives = values.flatMap((value) => (value.kind === "Primitive" ? [value.value] : []));
  return primitives.length === values.length ? primitives : null;
};

const getLiteralElements = (source: SymbolicValue | null): SymbolicValue[] | null => {
  if (source === null) return [];
  return source.kind === "ArrayExpression" && source.spreads.length === 0 ? source.elements : null;
};

export const isCollectionRead = (methodName: string): boolean => COLLECTION_READS.has(methodName);

export const isCollectionWrite = (methodName: string): boolean => COLLECTION_WRITES.has(methodName);

const getLiteralSource = (value: CollectionValue): LiteralCollection | null => {
  const elements = getLiteralElements(value.source);
  if (!elements) return null;
  if (value.collection === "Set") {
    const items = getPrimitives(elements);
    return items && new Set(items);
  }
  const entries: Array<[PrimitiveValue, PrimitiveValue]> = [];
  for (const element of elements) {
    const pair = getPrimitives(getLiteralElements(element) ?? []);
    if (!pair || pair.length !== 2) return null;
    entries.push([pair[0], pair[1]]);
  }
  return new Map(entries);
};

const applyWrite = (
  collection: LiteralCollection,
  write: CollectionValue["writes"][number],
): boolean => {
  const argumentValues = getPrimitives(write.argumentValues);
  const method: unknown = Reflect.get(collection, write.method);
  if (write.guards.length > 0 || !argumentValues || typeof method !== "function") return false;
  Reflect.apply(method, collection, argumentValues);
  return true;
};

const getLiteralCollection = (value: CollectionValue): LiteralCollection | null => {
  const source = value.source;
  const collection =
    source?.kind === "Collection"
      ? source.collection === value.collection
        ? getLiteralCollection(source)
        : null
      : getLiteralSource(value);
  if (!collection) return null;
  return value.writes.every((write) => applyWrite(collection, write)) ? collection : null;
};

export const applyCollectionMethod = (
  value: CollectionValue,
  methodName: string,
  argumentValues: PrimitiveValue[],
): PrimitiveValue | null => {
  const collection = getLiteralCollection(value);
  return collection && isCollectionRead(methodName)
    ? applyMethod(collection, methodName, argumentValues)
    : null;
};

export const getCollectionSize = (value: CollectionValue): number | null =>
  getLiteralCollection(value)?.size ?? null;
