import { nativeFunction } from "../frameworks/stubs.js";
import type {
  SourceLocation,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import { createErrorValue } from "./errors.js";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  accessorEntry,
  getObjectProperty,
  isNullish,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  thrownValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

/**
 * IndexedDB as a fresh browser profile holds it: no database exists until the
 * interpreted code creates one, so only its own writes are readable. Requests
 * settle in tasks, as the browser fires their events after the code that
 * assigned the handlers ran; a transaction completes in a task after its last
 * request. A name the analysis cannot read makes the contents uncertain: an
 * unknown store name may alias any store, an unknown database name any
 * database opened before or after it.
 */
interface IndexedDbRecord {
  key: StaticValue;
  value: StaticValue;
}

interface IndexedDbStore {
  keyPath: string | null;
  autoIncrement: boolean;
  nextKey: number;
  records: Map<string, IndexedDbRecord>;
}

interface IndexedDbDatabase {
  version: number;
  stores: Map<string, IndexedDbStore>;
  /** A store was created or written under a name the analysis cannot read. */
  hasUnknownWrites: boolean;
  target: EventTargetModel;
  upgradeTransaction: TransactionModel | null;
}

interface IndexedDbFactory {
  databases: Map<string, IndexedDbDatabase>;
  hasUnknownDatabase: boolean;
}

export interface IndexedDbHost {
  /** Runs `task` in a later task of the event loop, as the browser fires request events. */
  schedule: (task: () => void) => void;
  call: (callee: StaticValue, args: StaticValue[]) => StaticValue;
  setProperty: (object: StaticObjectValue, key: string, value: StaticValue) => void;
  location: SourceLocation | null;
}

interface EventTargetModel {
  value: StaticObjectValue;
  listeners: Map<string, StaticValue[]>;
}

interface TransactionModel extends EventTargetModel {
  begin: () => void;
  end: () => void;
  fail: (error: StaticValue) => void;
  onFinished: (task: () => void) => void;
}

type RequestOutcome = { result: StaticValue } | { error: StaticValue };

const INDEXED_DB_NAME = /^(?:(?:window|globalThis|self)\.)?indexedDB$/;

export const isIndexedDbName = (globalName: string): boolean => INDEXED_DB_NAME.test(globalName);

export const createIndexedDbFactory = (): IndexedDbFactory => ({
  databases: new Map(),
  hasUnknownDatabase: false,
});

const toKnownString = (value: StaticValue | undefined): string | null =>
  value?.kind === "primitive" && typeof value.value === "string" ? value.value : null;

const toKnownNumber = (value: StaticValue | undefined): number | null =>
  value?.kind === "primitive" && typeof value.value === "number" && !Number.isNaN(value.value)
    ? value.value
    : null;

const isOmitted = (value: StaticValue | undefined): boolean =>
  value === undefined || (value.kind === "primitive" && value.value === undefined);

/** The identity of a key the store can index: strings and numbers compare by value and never collide across types. */
const toRecordKey = (value: StaticValue | undefined): string | null => {
  const text = toKnownString(value);
  if (text !== null) return `string:${text}`;
  const number = toKnownNumber(value);
  return number === null ? null : `number:${number}`;
};

/** IndexedDB key order: numbers ascending before strings in code unit order. */
const compareKeys = (left: StaticValue, right: StaticValue): number => {
  const leftNumber = toKnownNumber(left);
  const rightNumber = toKnownNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  const leftText = toKnownString(left) ?? "";
  const rightText = toKnownString(right) ?? "";
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};

const sortedRecords = (store: IndexedDbStore): IndexedDbRecord[] =>
  [...store.records.values()].sort((left, right) => compareKeys(left.key, right.key));

const propertyEntries = (record: Record<string, StaticValue>): StaticObjectEntry[] =>
  Object.entries(record).map(([key, value]) => ({ kind: "property", key, value }));

const domError = (message: string, location: SourceLocation | null): StaticValue =>
  createErrorValue("Error", [primitiveValue(message)], location);

const createEventTarget = (record: Record<string, StaticValue>): EventTargetModel => {
  const listeners = new Map<string, StaticValue[]>();
  const value = objectFromRecord({
    ...record,
    addEventListener: nativeFunction("addEventListener", ([type, listener]) => {
      const typeName = toKnownString(type);
      if (typeName === null || !listener) return UNDEFINED_VALUE;
      const registered = listeners.get(typeName) ?? [];
      if (!registered.includes(listener)) listeners.set(typeName, [...registered, listener]);
      return UNDEFINED_VALUE;
    }),
    removeEventListener: nativeFunction("removeEventListener", ([type, listener]) => {
      const typeName = toKnownString(type);
      if (typeName === null || !listener) return UNDEFINED_VALUE;
      listeners.set(
        typeName,
        (listeners.get(typeName) ?? []).filter((registered) => registered !== listener),
      );
      return UNDEFINED_VALUE;
    }),
  });
  return { value, listeners };
};

const dispatchEvent = (
  host: IndexedDbHost,
  target: EventTargetModel,
  type: string,
  eventProperties: Record<string, StaticValue> = {},
): void => {
  const event = objectFromRecord({
    type: primitiveValue(type),
    target: target.value,
    currentTarget: target.value,
    ...eventProperties,
  });
  const handler = getObjectProperty(target.value, `on${type}`);
  if (isNullish(handler) !== true) host.call(handler, [event]);
  for (const listener of target.listeners.get(type) ?? []) host.call(listener, [event]);
};

const createRequest = (
  source: StaticValue,
  transaction: TransactionModel | null,
): EventTargetModel =>
  createEventTarget({
    result: UNDEFINED_VALUE,
    error: NULL_VALUE,
    readyState: primitiveValue("pending"),
    source,
    transaction: transaction?.value ?? NULL_VALUE,
    onsuccess: NULL_VALUE,
    onerror: NULL_VALUE,
  });

/** Fires the request's `success` or `error` in a later task; an error aborts its transaction. */
const settleRequest = (
  host: IndexedDbHost,
  request: EventTargetModel,
  transaction: TransactionModel | null,
  outcome: RequestOutcome,
): StaticValue => {
  transaction?.begin();
  host.schedule(() => {
    host.setProperty(request.value, "readyState", primitiveValue("done"));
    if ("result" in outcome) {
      host.setProperty(request.value, "result", outcome.result);
      dispatchEvent(host, request, "success");
    } else {
      host.setProperty(request.value, "error", outcome.error);
      dispatchEvent(host, request, "error");
      transaction?.fail(outcome.error);
    }
    transaction?.end();
  });
  return request.value;
};

const getStore = (
  database: IndexedDbDatabase,
  storeName: StaticValue | undefined,
): IndexedDbStore | null | undefined => {
  const knownName = toKnownString(storeName);
  return knownName === null || database.hasUnknownWrites ? null : database.stores.get(knownName);
};

const createTransaction = (
  host: IndexedDbHost,
  database: IndexedDbDatabase,
  storeNames: StaticValue,
  mode: string,
): TransactionModel => {
  let pendingRequests = 0;
  let isFinished = false;
  const finishedTasks: (() => void)[] = [];
  const target = createEventTarget({
    db: database.target.value,
    mode: primitiveValue(mode),
    durability: primitiveValue("default"),
    objectStoreNames: storeNames,
    error: NULL_VALUE,
    oncomplete: NULL_VALUE,
    onerror: NULL_VALUE,
    onabort: NULL_VALUE,
  });
  const finish = (type: "complete" | "abort"): void => {
    if (isFinished) return;
    isFinished = true;
    dispatchEvent(host, target, type);
    for (const task of finishedTasks) task();
  };
  const finishWhenIdle = (): void => {
    host.schedule(() => {
      if (pendingRequests === 0) finish("complete");
    });
  };
  const transaction: TransactionModel = {
    ...target,
    begin: () => {
      pendingRequests += 1;
    },
    end: () => {
      pendingRequests -= 1;
      if (pendingRequests === 0) finishWhenIdle();
    },
    fail: (error) => {
      host.setProperty(target.value, "error", error);
      dispatchEvent(host, target, "error");
      dispatchEvent(host, database.target, "error");
      finish("abort");
    },
    onFinished: (task) => {
      if (isFinished) task();
      else finishedTasks.push(task);
    },
  };
  target.value.entries.push(
    ...propertyEntries({
      objectStore: nativeFunction("objectStore", ([name]) =>
        createStoreValue(host, database, transaction, name),
      ),
      abort: nativeFunction("abort", () => {
        finish("abort");
        return UNDEFINED_VALUE;
      }),
      commit: nativeFunction("commit", () => UNDEFINED_VALUE),
    }),
  );
  finishWhenIdle();
  return transaction;
};

/** The key a write lands under: from the key path, the explicit key, or the key generator. */
const getWriteKey = (
  store: IndexedDbStore,
  recordValue: StaticValue,
  explicitKey: StaticValue | undefined,
): StaticValue | null => {
  const given =
    store.keyPath === null
      ? (explicitKey ?? UNDEFINED_VALUE)
      : recordValue.kind === "object"
        ? getObjectProperty(recordValue, store.keyPath)
        : null;
  if (given === null) return null;
  const isAbsent = isNullish(given);
  if (isAbsent === false) return given;
  return isAbsent === true && store.autoIncrement ? primitiveValue(store.nextKey) : null;
};

/**
 * An object store of `transaction`; under a name the analysis cannot read (or
 * once any store was), reads are uncertain and writes make every store's
 * contents uncertain.
 */
const createStoreValue = (
  host: IndexedDbHost,
  database: IndexedDbDatabase,
  transaction: TransactionModel,
  storeName: StaticValue | undefined,
): StaticValue => {
  const name = toKnownString(storeName);
  const store = getStore(database, storeName);
  if (store === undefined) {
    return thrownValue(
      "object store not found",
      domError(`One of the specified object stores was not found: "${name}".`, host.location),
      host.location,
    );
  }
  const value = objectFromRecord({
    name:
      name === null ? unknownPrimitiveValue("string", "IDBObjectStore.name") : primitiveValue(name),
    keyPath:
      store === null
        ? unknownValue("keyPath of an uncertain object store", host.location)
        : store.keyPath === null
          ? NULL_VALUE
          : primitiveValue(store.keyPath),
    autoIncrement:
      store === null
        ? unknownPrimitiveValue("boolean", "autoIncrement of an uncertain object store")
        : primitiveValue(store.autoIncrement),
    indexNames: listValue([]),
    transaction: transaction.value,
  });
  const request = (outcome: RequestOutcome): StaticValue =>
    settleRequest(host, createRequest(value, transaction), transaction, outcome);
  const uncertain = (detail: string): StaticValue =>
    unknownValue(`IndexedDB ${detail}`, host.location);
  const isUncertain = store === null || database.hasUnknownWrites;
  const write = (
    recordValue: StaticValue | undefined,
    explicitKey: StaticValue | undefined,
    isAdd: boolean,
  ): RequestOutcome => {
    const key = store && recordValue ? getWriteKey(store, recordValue, explicitKey) : null;
    const recordKey = toRecordKey(key ?? undefined);
    if (!store || !key || recordKey === null || !recordValue) {
      database.hasUnknownWrites = true;
      return { result: uncertain("key of a write it cannot follow") };
    }
    if (isAdd && store.records.has(recordKey))
      return { error: domError("Key already exists in the object store.", host.location) };
    const number = toKnownNumber(key);
    if (number !== null) store.nextKey = Math.max(store.nextKey, Math.floor(number) + 1);
    store.records.set(recordKey, { key, value: recordValue });
    return { result: key };
  };
  const read = (
    key: StaticValue | undefined,
    detail: string,
    pick: (record: IndexedDbRecord | undefined) => StaticValue,
  ): RequestOutcome => {
    if (isUncertain) return { result: uncertain(`${detail} of uncertain contents`) };
    const recordKey = toRecordKey(key);
    if (recordKey === null) return { result: uncertain(`${detail} with a dynamic key`) };
    return { result: pick(store.records.get(recordKey)) };
  };
  const readAll = (
    range: StaticValue | undefined,
    detail: string,
    pick: (records: IndexedDbRecord[]) => StaticValue,
  ): RequestOutcome => {
    if (isUncertain) return { result: uncertain(`${detail} of uncertain contents`) };
    if (range !== undefined && isNullish(range) !== true)
      return { result: uncertain(`${detail} over a key range`) };
    return { result: pick(sortedRecords(store)) };
  };
  const unfollowed = (detail: string): RequestOutcome => ({
    result: uncertain(`${detail} the analysis does not follow`),
  });
  value.entries.push(
    ...propertyEntries({
      get: nativeFunction("get", ([key]) =>
        request(read(key, "get()", (record) => record?.value ?? UNDEFINED_VALUE)),
      ),
      getKey: nativeFunction("getKey", ([key]) =>
        request(read(key, "getKey()", (record) => record?.key ?? UNDEFINED_VALUE)),
      ),
      getAll: nativeFunction("getAll", ([range]) =>
        request(
          readAll(range, "getAll()", (records) => listValue(records.map((record) => record.value))),
        ),
      ),
      getAllKeys: nativeFunction("getAllKeys", ([range]) =>
        request(
          readAll(range, "getAllKeys()", (records) =>
            listValue(records.map((record) => record.key)),
          ),
        ),
      ),
      count: nativeFunction("count", ([range]) =>
        request(readAll(range, "count()", (records) => primitiveValue(records.length))),
      ),
      put: nativeFunction("put", ([recordValue, key]) => request(write(recordValue, key, false))),
      add: nativeFunction("add", ([recordValue, key]) => request(write(recordValue, key, true))),
      delete: nativeFunction("delete", ([key]) => {
        const recordKey = toRecordKey(key);
        if (!store || recordKey === null) database.hasUnknownWrites = true;
        else store.records.delete(recordKey);
        return request({ result: UNDEFINED_VALUE });
      }),
      clear: nativeFunction("clear", () => {
        if (store) store.records.clear();
        else database.hasUnknownWrites = true;
        return request({ result: UNDEFINED_VALUE });
      }),
      openCursor: nativeFunction("openCursor", () => request(unfollowed("cursor"))),
      openKeyCursor: nativeFunction("openKeyCursor", () => request(unfollowed("cursor"))),
      createIndex: nativeFunction("createIndex", () =>
        uncertain("index the analysis does not follow"),
      ),
      index: nativeFunction("index", () => uncertain("index the analysis does not follow")),
    }),
  );
  return value;
};

/** `db.objectStoreNames`: a `DOMStringList` of the current store names. */
const storeNamesValue = (database: IndexedDbDatabase): StaticValue => {
  const names = [...database.stores.keys()].sort();
  return objectValue([
    ...names.map((name, index): StaticObjectEntry => ({
      kind: "property",
      key: String(index),
      value: primitiveValue(name),
    })),
    ...propertyEntries({
      length: primitiveValue(names.length),
      contains: nativeFunction("contains", ([name]) => {
        const storeName = toKnownString(name);
        return database.hasUnknownWrites || storeName === null
          ? unknownPrimitiveValue("boolean", "objectStoreNames.contains() over uncertain stores")
          : primitiveValue(database.stores.has(storeName));
      }),
      item: nativeFunction("item", ([index]) => {
        const position = toKnownNumber(index);
        if (position === null)
          return unknownValue("objectStoreNames.item() with a dynamic index", null);
        const name = names[position];
        return name === undefined ? NULL_VALUE : primitiveValue(name);
      }),
    }),
  ]);
};

const createDatabase = (
  host: IndexedDbHost,
  name: string | null,
  version: number,
): IndexedDbDatabase => {
  const target = createEventTarget({
    name:
      name === null ? unknownPrimitiveValue("string", "IDBDatabase.name") : primitiveValue(name),
    version: primitiveValue(version),
    onversionchange: NULL_VALUE,
    onclose: NULL_VALUE,
    onerror: NULL_VALUE,
    onabort: NULL_VALUE,
  });
  const database: IndexedDbDatabase = {
    version,
    stores: new Map(),
    hasUnknownWrites: false,
    target,
    upgradeTransaction: null,
  };
  target.value.entries.push(
    accessorEntry(
      "objectStoreNames",
      { get: nativeFunction("objectStoreNames", () => storeNamesValue(database)), set: null },
      host.location,
    ),
    ...propertyEntries({
      createObjectStore: nativeFunction("createObjectStore", ([storeName, options]) => {
        const upgrade = database.upgradeTransaction;
        if (!upgrade) {
          return thrownValue(
            "createObjectStore outside a versionchange transaction",
            domError("The database is not running a version change transaction.", host.location),
            host.location,
          );
        }
        const knownName = toKnownString(storeName);
        const keyPath =
          options?.kind === "object" ? getObjectProperty(options, "keyPath") : UNDEFINED_VALUE;
        const autoIncrement =
          options?.kind === "object"
            ? getObjectProperty(options, "autoIncrement")
            : UNDEFINED_VALUE;
        const isKeyPathKnown = isNullish(keyPath) === true || toKnownString(keyPath) !== null;
        if (knownName === null || !isKeyPathKnown || autoIncrement.kind !== "primitive") {
          database.hasUnknownWrites = true;
          return createStoreValue(host, database, upgrade, storeName);
        }
        database.stores.set(knownName, {
          keyPath: toKnownString(keyPath),
          autoIncrement: Boolean(autoIncrement.value),
          nextKey: 1,
          records: new Map(),
        });
        return createStoreValue(host, database, upgrade, storeName);
      }),
      deleteObjectStore: nativeFunction("deleteObjectStore", ([storeName]) => {
        const knownName = toKnownString(storeName);
        if (knownName === null) database.hasUnknownWrites = true;
        else database.stores.delete(knownName);
        return UNDEFINED_VALUE;
      }),
      transaction: nativeFunction(
        "transaction",
        ([storeNames, mode]) =>
          createTransaction(
            host,
            database,
            storeNames?.kind === "list" ? storeNames : listValue(storeNames ? [storeNames] : []),
            toKnownString(mode) ?? "readonly",
          ).value,
      ),
      close: nativeFunction("close", () => UNDEFINED_VALUE),
    }),
  );
  return database;
};

const openDatabase = (
  host: IndexedDbHost,
  factory: IndexedDbFactory,
  [nameArgument, versionArgument]: StaticValue[],
): StaticValue => {
  const name = toKnownString(nameArgument);
  const requestedVersion = isOmitted(versionArgument) ? undefined : toKnownNumber(versionArgument);
  const request = createRequest(NULL_VALUE, null);
  const mayAlias = factory.hasUnknownDatabase || (name === null && factory.databases.size > 0);
  if (mayAlias || requestedVersion === null) {
    return settleRequest(host, request, null, {
      result: unknownValue(
        "IndexedDB database opened under an uncertain name or version",
        host.location,
      ),
    });
  }
  const existing = name === null ? undefined : factory.databases.get(name);
  const oldVersion = existing?.version ?? 0;
  const newVersion = requestedVersion ?? Math.max(oldVersion, 1);
  if (newVersion < oldVersion) {
    return settleRequest(host, request, null, {
      error: domError("The requested version is less than the existing version.", host.location),
    });
  }
  const database = existing ?? createDatabase(host, name, newVersion);
  if (name === null) factory.hasUnknownDatabase = true;
  else factory.databases.set(name, database);
  if (newVersion === oldVersion) {
    return settleRequest(host, request, null, { result: database.target.value });
  }
  database.version = newVersion;
  host.setProperty(database.target.value, "version", primitiveValue(newVersion));
  host.schedule(() => {
    const upgrade = createTransaction(host, database, storeNamesValue(database), "versionchange");
    database.upgradeTransaction = upgrade;
    host.setProperty(request.value, "result", database.target.value);
    host.setProperty(request.value, "transaction", upgrade.value);
    dispatchEvent(host, request, "upgradeneeded", {
      oldVersion: primitiveValue(oldVersion),
      newVersion: primitiveValue(newVersion),
    });
    upgrade.onFinished(() => {
      database.upgradeTransaction = null;
      host.setProperty(request.value, "transaction", NULL_VALUE);
      host.setProperty(request.value, "readyState", primitiveValue("done"));
      dispatchEvent(host, request, "success");
    });
  });
  return request.value;
};

export const callIndexedDbMethod = (
  host: IndexedDbHost,
  factory: IndexedDbFactory,
  name: string,
  args: StaticValue[],
): StaticValue | null => {
  switch (name) {
    case "open":
      return openDatabase(host, factory, args);
    case "deleteDatabase": {
      const databaseName = toKnownString(args[0]);
      if (databaseName === null) factory.hasUnknownDatabase = true;
      else if (!factory.hasUnknownDatabase) factory.databases.delete(databaseName);
      return settleRequest(host, createRequest(NULL_VALUE, null), null, {
        result: UNDEFINED_VALUE,
      });
    }
    case "cmp":
      return unknownPrimitiveValue("number", "indexedDB.cmp()");
    default:
      return null;
  }
};
