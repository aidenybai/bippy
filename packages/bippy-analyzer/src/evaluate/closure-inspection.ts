import inspector from "node:inspector";

/**
 * The variables a function closed over, read through V8's `[[Scopes]]`
 * internal property: the debugger's view of a closure, which the language
 * itself never exposes. A session connected to its own thread answers `post`
 * before it returns, so the read is synchronous.
 */
export interface CapturedBinding {
  name: string;
  value: unknown;
}

const HOOK_KEY = Symbol.for("bippy-analyzer.closure-inspection");
const HOOK_EXPRESSION = `globalThis[Symbol.for("${HOOK_KEY.description}")]`;
const OBJECT_GROUP = "bippy-analyzer.closure-inspection";

/** Scopes whose variables a function can reference by name; the global scope resolves through the host realm instead. */
const CAPTURABLE_SCOPE_KINDS: ReadonlySet<string> = new Set([
  "closure",
  "local",
  "block",
  "module",
  "script",
  "catch",
  "with",
]);

const takeHookValue = (): unknown => {
  const value: unknown = Reflect.get(globalThis, HOOK_KEY);
  Reflect.deleteProperty(globalThis, HOOK_KEY);
  return value;
};

let session: inspector.Session | null | undefined;

const getSession = (): inspector.Session | null => {
  if (session !== undefined) return session;
  try {
    session = new inspector.Session();
    session.connect();
  } catch {
    session = null;
  }
  return session;
};

const post = <Result>(
  request: (callback: (error: Error | null, result: Result) => void) => void,
): Result => {
  let outcome: { error: Error | null; result: Result } | null = null;
  request((error, result) => {
    outcome = { error, result };
  });
  if (outcome === null) throw new Error("the inspector did not answer synchronously");
  const { error, result } = outcome;
  if (error) throw error;
  return result;
};

/** A remote handle to a local value, parked on a global the inspector can evaluate. */
const toRemoteObject = (
  activeSession: inspector.Session,
  value: unknown,
): inspector.Runtime.RemoteObject => {
  Reflect.set(globalThis, HOOK_KEY, value);
  try {
    return post<inspector.Runtime.EvaluateReturnType>((callback) =>
      activeSession.post(
        "Runtime.evaluate",
        { expression: HOOK_EXPRESSION, objectGroup: OBJECT_GROUP },
        callback,
      ),
    ).result;
  } finally {
    takeHookValue();
  }
};

const readUnserializable = (remote: inspector.Runtime.RemoteObject): unknown => {
  switch (remote.unserializableValue) {
    case "NaN":
      return NaN;
    case "Infinity":
      return Infinity;
    case "-Infinity":
      return -Infinity;
    case "-0":
      return -0;
    default:
      return remote.type === "bigint" && remote.unserializableValue !== undefined
        ? BigInt(remote.unserializableValue.slice(0, -1))
        : undefined;
  }
};

/** The live local value a remote handle refers to, pulled back through the same global hook; strict, so a symbol is not boxed as `this`. */
const toLocalValue = (
  activeSession: inspector.Session,
  remote: inspector.Runtime.RemoteObject,
): unknown => {
  if (remote.unserializableValue !== undefined) return readUnserializable(remote);
  if (remote.objectId === undefined) {
    const primitive: unknown = remote.value;
    return primitive;
  }
  post<inspector.Runtime.CallFunctionOnReturnType>((callback) =>
    activeSession.post(
      "Runtime.callFunctionOn",
      {
        objectId: remote.objectId,
        functionDeclaration: `function () { "use strict"; ${HOOK_EXPRESSION} = this; }`,
      },
      callback,
    ),
  );
  return takeHookValue();
};

const getProperties = (
  activeSession: inspector.Session,
  objectId: string,
): inspector.Runtime.GetPropertiesReturnType =>
  post((callback) =>
    activeSession.post("Runtime.getProperties", { objectId, ownProperties: true }, callback),
  );

/** The engine's `[[Name]]` internal properties of an object, which no language operation reads. */
const getInternalProperties = (
  activeSession: inspector.Session,
  objectId: string,
): Map<string, inspector.Runtime.RemoteObject> =>
  new Map(
    (getProperties(activeSession, objectId).internalProperties ?? []).flatMap((property) =>
      property.value === undefined ? [] : [[property.name, property.value]],
    ),
  );

const getScopeKind = (scope: inspector.Runtime.RemoteObject): string =>
  (scope.description ?? "").split(/[\s(]/, 1)[0].toLowerCase();

const releaseHandles = (activeSession: inspector.Session): void => {
  activeSession.post("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP }, () => {});
};

const inspectFunction = <Result>(
  callee: Function,
  read: (
    activeSession: inspector.Session,
    internals: Map<string, inspector.Runtime.RemoteObject>,
  ) => Result | null,
): Result | null => {
  const activeSession = getSession();
  if (activeSession === null) return null;
  try {
    const remote = toRemoteObject(activeSession, callee);
    if (remote.objectId === undefined) return null;
    return read(activeSession, getInternalProperties(activeSession, remote.objectId));
  } catch {
    return null;
  } finally {
    releaseHandles(activeSession);
  }
};

/**
 * Every variable `callee` captured that `isWanted` accepts, innermost scope
 * first; a name shadowed by an inner scope appears once. Null when the process
 * has no inspector or the read failed, so the caller cannot mistake an
 * unreadable closure for one that captured nothing.
 */
export const inspectClosure = (
  callee: Function,
  isWanted: (name: string) => boolean = () => true,
): CapturedBinding[] | null =>
  inspectFunction(callee, (activeSession, internals) => {
    const scopes = internals.get("[[Scopes]]")?.objectId;
    if (scopes === undefined) return [];
    const seen = new Set<string>();
    const captured: CapturedBinding[] = [];
    for (const entry of getProperties(activeSession, scopes).result) {
      const scope = entry.value;
      if (scope?.objectId === undefined || !CAPTURABLE_SCOPE_KINDS.has(getScopeKind(scope)))
        continue;
      for (const variable of getProperties(activeSession, scope.objectId).result) {
        if (variable.value === undefined || seen.has(variable.name)) continue;
        seen.add(variable.name);
        if (!isWanted(variable.name)) continue;
        captured.push({
          name: variable.name,
          value: toLocalValue(activeSession, variable.value),
        });
      }
    }
    return captured;
  });

/** What `Function.prototype.bind` combined into a bound function, which has no source of its own. */
export interface BoundFunctionParts {
  target: Function;
  boundThis: unknown;
  boundArgs: unknown[];
}

/**
 * The function, receiver and leading arguments a bound function stands for,
 * read through V8's `[[TargetFunction]]`, `[[BoundThis]]` and `[[BoundArgs]]`.
 * Null for a function that is not bound, or when the read failed.
 */
export const inspectBoundFunction = (callee: Function): BoundFunctionParts | null =>
  inspectFunction(callee, (activeSession, internals) => {
    const target = internals.get("[[TargetFunction]]");
    if (target === undefined) return null;
    const targetValue = toLocalValue(activeSession, target);
    if (typeof targetValue !== "function") return null;
    const readInternal = (name: string): unknown => {
      const internal = internals.get(name);
      return internal === undefined ? undefined : toLocalValue(activeSession, internal);
    };
    const boundArgs = readInternal("[[BoundArgs]]");
    return {
      target: targetValue,
      boundThis: readInternal("[[BoundThis]]"),
      boundArgs: Array.isArray(boundArgs) ? boundArgs : [],
    };
  });
