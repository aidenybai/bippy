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

const copyCollection = (collection: LiteralCollection): LiteralCollection =>
  collection instanceof Set ? new Set(collection) : new Map(collection);

const getSourceCollection = (value: CollectionValue): LiteralCollection | null => {
  const { source } = value;
  if (source?.kind === "Collection") {
    const copied = source.collection === value.collection ? getLiteralCollection(source) : null;
    return copied && copyCollection(copied);
  }
  const elements = getLiteralElements(source);
  if (!elements) return null;
  if (value.collection === "Set") {
    const items = getPrimitives(elements);
    return items && new Set(items);
  }
  const entries: Array<[PrimitiveValue, PrimitiveValue]> = [];
  for (const element of elements) {
    const pair = getPrimitives(getLiteralElements(element) ?? []);
    const [key, entryValue] = pair ?? [];
    if (!pair || pair.length !== 2) return null;
    entries.push([key, entryValue]);
  }
  return new Map(entries);
};

export const isCollectionWrite = (methodName: string): boolean => COLLECTION_WRITES.has(methodName);

export const getLiteralCollection = (value: CollectionValue): LiteralCollection | null => {
  const collection = getSourceCollection(value);
  for (const write of value.writes) {
    const argumentValues = getPrimitives(write.argumentValues);
    const method: unknown = collection ? Reflect.get(collection, write.method) : null;
    if (!collection || !argumentValues || typeof method !== "function") return null;
    Reflect.apply(method, collection, argumentValues);
  }
  return collection;
};

export const applyArrayMethod = (
  methodName: string,
  receiver: PrimitiveValue[],
  argumentValues: PrimitiveValue[],
): PrimitiveValue | null =>
  Reflect.has(Array.prototype, methodName)
    ? applyMethod(receiver, methodName, argumentValues)
    : null;

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
