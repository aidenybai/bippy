import type {
  AbstractValue,
  BindingValue,
  CollectionContents,
  CollectionValue,
  PrimitiveValue,
  SymbolicValue,
} from "../types";

type LiteralCollection = Set<PrimitiveValue> | Map<PrimitiveValue, PrimitiveValue>;

export interface CollectionOwner {
  source: BindingValue;
  value: AbstractValue;
}

export interface CollectionReader {
  read: (source: BindingValue) => AbstractValue[] | null | undefined;
  decide: (guards: SymbolicValue[], owner: CollectionOwner | null) => boolean | null;
}

const LITERAL_READER: CollectionReader = { read: () => null, decide: () => null };

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

const fromContents = (contents: CollectionContents): LiteralCollection =>
  contents.collection === "Set"
    ? new Set(contents.entries.map(([key]) => key))
    : new Map(contents.entries);

const isContentsOf = (
  value: AbstractValue,
  kind: CollectionValue["collection"],
): value is CollectionContents => value.kind === "Collection" && value.collection === kind;

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
    const [key, entryValue] = pair ?? [];
    if (!pair || pair.length !== 2) return null;
    entries.push([key, entryValue]);
  }
  return new Map(entries);
};

interface CollectionCase {
  collection: LiteralCollection;
  owner: CollectionOwner | null;
}

const getSourceCases = (
  value: CollectionValue,
  reader: CollectionReader,
): CollectionCase[] | null => {
  const { source } = value;
  if (source?.kind === "Binding") {
    const cases = reader.read(source);
    if (!cases || cases.length === 0) return null;
    const contents = cases.filter((candidate) => isContentsOf(candidate, value.collection));
    return contents.length === cases.length
      ? contents.map((ownerValue) => ({
          collection: fromContents(ownerValue),
          owner: { source, value: ownerValue },
        }))
      : null;
  }
  if (source?.kind === "Collection")
    return source.collection === value.collection
      ? (getCases(source, reader)?.map(({ collection, owner }) => ({
          collection: copyCollection(collection),
          owner,
        })) ?? null)
      : null;
  const literal = getLiteralSource(value);
  return literal && [{ collection: literal, owner: null }];
};

const applyWrite = (
  { collection, owner }: CollectionCase,
  write: CollectionValue["writes"][number],
  reader: CollectionReader,
): boolean => {
  const argumentValues = getPrimitives(write.argumentValues);
  const method: unknown = Reflect.get(collection, write.method);
  const isApplied = write.guards.length === 0 ? true : reader.decide(write.guards, owner);
  if (!argumentValues || typeof method !== "function" || isApplied === null) return false;
  if (isApplied) Reflect.apply(method, collection, argumentValues);
  return true;
};

const getCases = (value: CollectionValue, reader: CollectionReader): CollectionCase[] | null => {
  const cases = getSourceCases(value, reader);
  for (const write of value.writes)
    if (!cases?.every((current) => applyWrite(current, write, reader))) return null;
  return cases;
};

export const isCollectionWrite = (methodName: string): boolean => COLLECTION_WRITES.has(methodName);

export const getLiteralCollection = (value: CollectionValue): LiteralCollection | null => {
  const cases = getCases(value, LITERAL_READER);
  return cases?.length === 1 ? cases[0].collection : null;
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
