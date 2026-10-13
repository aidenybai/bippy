export interface InspectionError {
  error: Error;
}

export interface InspectionRecord {
  data: Record<string, unknown>;
  revision: number;
  uid: string;
}

export interface InspectionBackend {
  inspect: (uid: string) => InspectionRecord;
}

export interface InspectionMessage {
  count: number;
  message: string;
}

export interface InspectionModel {
  clearErrors: (uid?: string) => void;
  clearWarnings: (uid?: string) => void;
  copyValue: (uid: string, path: Array<number | string>) => string | InspectionError;
  getErrors: (uid: string) => InspectionMessage[];
  getWarnings: (uid: string) => InspectionMessage[];
  hydrate: (uid: string, path: Array<number | string>) => unknown | InspectionError;
  inspect: (uid: string, force?: boolean) => InspectionRecord | InspectionError;
  invalidate: () => void;
  recordError: (uid: string, message: string) => void;
  recordWarning: (uid: string, message: string) => void;
  storeAsGlobal: (
    uid: string,
    path: Array<number | string>,
    target: Record<string, unknown>,
    name: string,
  ) => boolean;
}

const isInspectionError = (value: unknown): value is InspectionError =>
  typeof value === "object" && value !== null && Reflect.get(value, "error") instanceof Error;

const getPathValue = (value: unknown, path: Array<number | string>): unknown => {
  let current = value;
  for (const property of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, property);
  }
  return current;
};

const recordMessage = (
  messages: Map<string, Map<string, number>>,
  uid: string,
  message: string,
): void => {
  const componentMessages = messages.get(uid) ?? new Map<string, number>();
  componentMessages.set(message, (componentMessages.get(message) ?? 0) + 1);
  messages.set(uid, componentMessages);
};

const getMessages = (
  messages: Map<string, Map<string, number>>,
  uid: string,
): InspectionMessage[] =>
  [...(messages.get(uid) ?? [])].map(([message, count]) => ({ count, message }));

export const createInspectionModel = (backend: InspectionBackend): InspectionModel => {
  const cache = new Map<string, InspectionRecord>();
  const errors = new Map<string, Map<string, number>>();
  const warnings = new Map<string, Map<string, number>>();

  const inspect = (uid: string, force = false): InspectionRecord | InspectionError => {
    if (!force) {
      const cached = cache.get(uid);
      if (cached) return cached;
    }
    const originalError = console.error;
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.error = () => undefined;
    console.log = () => undefined;
    console.warn = () => undefined;
    try {
      const record = backend.inspect(uid);
      const cached = cache.get(uid);
      if (!cached || cached.revision !== record.revision || force) cache.set(uid, record);
      return cache.get(uid) ?? record;
    } catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      console.error = originalError;
      console.log = originalLog;
      console.warn = originalWarn;
    }
  };

  const hydrate = (uid: string, path: Array<number | string>): unknown | InspectionError => {
    const record = inspect(uid, true);
    return "error" in record ? record : getPathValue(record.data, path);
  };

  const clearMessages = (messages: Map<string, Map<string, number>>, uid?: string): void => {
    if (uid) messages.delete(uid);
    else messages.clear();
  };

  return {
    clearErrors: (uid) => clearMessages(errors, uid),
    clearWarnings: (uid) => clearMessages(warnings, uid),
    copyValue: (uid, path) => {
      const value = hydrate(uid, path);
      if (isInspectionError(value)) return value;
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    },
    getErrors: (uid) => getMessages(errors, uid),
    getWarnings: (uid) => getMessages(warnings, uid),
    hydrate,
    inspect,
    invalidate: () => cache.clear(),
    recordError: (uid, message) => recordMessage(errors, uid, message),
    recordWarning: (uid, message) => recordMessage(warnings, uid, message),
    storeAsGlobal: (uid, path, target, name) => {
      const value = hydrate(uid, path);
      if (isInspectionError(value)) return false;
      return Reflect.set(target, name, value);
    },
  };
};
