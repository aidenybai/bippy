import type {
  RuntimeFiberSnapshot,
  RuntimeSnapshot,
  SnapshotPropValue,
  SnapshotWorkTag,
} from "./snapshot.js";

interface PreactOptions {
  _commit?: (...args: unknown[]) => void;
  __c?: (...args: unknown[]) => void;
}

interface PreactInternals {
  Fragment?: unknown;
}

interface PreactDevTools {
  attachPreact: (version: string, options: PreactOptions, internals: PreactInternals) => void;
}

export interface PreactRecorder {
  snapshot: () => RuntimeSnapshot;
  commitCount: () => number;
}

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const getProperty = (value: object, name: string): unknown => Reflect.get(value, name);

const getAliasedProperty = (value: object, sourceName: string, bundledName: string): unknown =>
  getProperty(value, sourceName) ?? getProperty(value, bundledName);

const getVNodeChildren = (vnode: object): object[] => {
  const children = getAliasedProperty(vnode, "_children", "__k");
  return Array.isArray(children) ? children.filter(isObject) : [];
};

const getVNodeType = (vnode: object): unknown => getProperty(vnode, "type");

const getFunctionName = (value: Function): string | null => {
  const displayName = getProperty(value, "displayName");
  if (typeof displayName === "string" && displayName) return displayName;
  return value.name || null;
};

const getContext = (value: Function): object | null => {
  const context = getProperty(value, "_contextRef");
  return isObject(context) ? context : null;
};

const getContextName = (context: object): string | null => {
  const displayName = getProperty(context, "displayName");
  return typeof displayName === "string" && displayName ? displayName : null;
};

const getFunctionTag = (value: Function): SnapshotWorkTag => {
  if (getContext(value)) {
    return value.name === "Consumer" ? "ContextConsumer" : "ContextProvider";
  }
  const reactType = getProperty(value, "$$typeof");
  if (typeof reactType === "symbol" && reactType.description === "react.forward_ref") {
    return "ForwardRef";
  }
  const displayName = getFunctionName(value);
  if (
    (typeof reactType === "symbol" && reactType.description === "react.memo") ||
    displayName?.startsWith("Memo(")
  ) {
    return "MemoComponent";
  }
  const prototype = getProperty(value, "prototype");
  return isObject(prototype) && typeof getProperty(prototype, "render") === "function"
    ? "ClassComponent"
    : "FunctionComponent";
};

const MAX_STRING_PROP_LENGTH = 200;

const getSnapshotProp = (value: unknown): SnapshotPropValue | undefined => {
  if (typeof value === "string") {
    return value.length > MAX_STRING_PROP_LENGTH
      ? `${value.slice(0, MAX_STRING_PROP_LENGTH)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return value.toString();
  if (value === null) return null;
  if (Array.isArray(value)) return "[array]";
  return typeof value === "object" ? "[object]" : undefined;
};

const getSnapshotProps = (
  vnode: object,
  hasDirectText: boolean,
): Record<string, SnapshotPropValue> => {
  const vnodeProps = getProperty(vnode, "props");
  if (!isObject(vnodeProps)) return {};
  const props: Record<string, SnapshotPropValue> = {};
  for (const [name, value] of Object.entries(vnodeProps)) {
    if (name === "children" && !hasDirectText) continue;
    const prop = getSnapshotProp(value);
    if (prop !== undefined) props[name] = prop;
  }
  return props;
};

const getVNodeKey = (vnode: object): string | null => {
  const key = getProperty(vnode, "key");
  return typeof key === "string" || typeof key === "number" ? String(key) : null;
};

const getText = (vnode: object): string => {
  const props = getProperty(vnode, "props");
  return typeof props === "string" || typeof props === "number" || typeof props === "bigint"
    ? String(props)
    : "";
};

const isTextVNode = (vnode: object): boolean => getVNodeType(vnode) === null;

const hasDirectText = (vnode: object, isHost: boolean): boolean => {
  if (!isHost) return false;
  const props = getProperty(vnode, "props");
  if (!isObject(props)) return false;
  const children = getProperty(props, "children");
  return (
    typeof children === "string" ||
    typeof children === "number" ||
    typeof children === "bigint"
  );
};

const getSnapshotChildren = (
  vnode: object,
  fragment: unknown,
  hasDirectTextChild: boolean,
): RuntimeFiberSnapshot[] => {
  const children = getVNodeChildren(vnode);
  if (hasDirectTextChild && children.length === 1 && isTextVNode(children[0])) return [];
  return children.map((child) => getVNodeSnapshot(child, fragment));
};

const getVNodeSnapshot = (vnode: object, fragment: unknown): RuntimeFiberSnapshot => {
  const type = getVNodeType(vnode);
  if (type === null) {
    return {
      tag: "HostText",
      name: null,
      key: null,
      text: getText(vnode),
      props: {},
      children: [],
    };
  }
  const isHost = typeof type === "string";
  const directText = hasDirectText(vnode, isHost);
  const tag: SnapshotWorkTag =
    type === fragment
      ? "Fragment"
      : isHost
        ? "HostComponent"
        : typeof type === "function"
          ? getFunctionTag(type)
          : "Unknown";
  const name =
    type === fragment
      ? "Fragment"
      : typeof type === "string"
        ? type
        : typeof type === "function"
          ? getFunctionName(type)
          : null;
  const context = typeof type === "function" ? getContext(type) : null;
  return {
    tag,
    name: context ? getContextName(context) : name,
    key: getVNodeKey(vnode),
    text: null,
    props: getSnapshotProps(vnode, directText),
    children: getSnapshotChildren(vnode, fragment, directText),
  };
};

const getRootContainerName = (root: object): string | null => {
  const dom = getAliasedProperty(root, "_dom", "__e");
  if (!isObject(dom)) return null;
  const parent = getProperty(dom, "parentNode");
  if (!isObject(parent)) return null;
  const nodeName = getProperty(parent, "nodeName");
  return typeof nodeName === "string" ? nodeName.toLowerCase() : null;
};

const getRootSnapshot = (root: object, fragment: unknown): RuntimeFiberSnapshot => {
  const container = getRootContainerName(root);
  return {
    tag: "HostRoot",
    name: "HostRoot",
    key: null,
    text: null,
    props: container === null ? {} : { container },
    children: getVNodeChildren(root).map((child) => getVNodeSnapshot(child, fragment)),
  };
};

const getRootVNode = (vnode: object): object => {
  let root = vnode;
  for (let parent = getAliasedProperty(root, "_parent", "__"); isObject(parent); ) {
    root = parent;
    parent = getAliasedProperty(root, "_parent", "__");
  }
  return root;
};

const getPreactDevTools = (target: object): PreactDevTools | null => {
  const devTools = getProperty(target, "__PREACT_DEVTOOLS__");
  if (!isObject(devTools)) return null;
  const attachPreact = getProperty(devTools, "attachPreact");
  if (typeof attachPreact !== "function") return null;
  return {
    attachPreact: (version, options, internals) =>
      Reflect.apply(attachPreact, devTools, [version, options, internals]),
  };
};

export const installPreactRecorder = (target: object): PreactRecorder => {
  let commits = 0;
  let version: string | null = null;
  let fragment: unknown;
  const roots = new Set<object>();
  const previousDevTools = getPreactDevTools(target);
  const devTools: PreactDevTools = {
    attachPreact: (nextVersion, options, internals) => {
      previousDevTools?.attachPreact(nextVersion, options, internals);
      version = nextVersion;
      fragment = internals.Fragment;
      const previousCommit = options._commit ?? options.__c;
      const recordCommit = (...args: unknown[]): void => {
        previousCommit?.(...args);
        const nextRoot = args[0];
        if (!isObject(nextRoot)) return;
        roots.add(getRootVNode(nextRoot));
        commits++;
      };
      if ("_commit" in options || !("__c" in options)) options._commit = recordCommit;
      else options.__c = recordCommit;
    },
  };
  Reflect.set(target, "__PREACT_DEVTOOLS__", devTools);
  return {
    snapshot: () => ({
      reactVersion: version,
      rendererName: version === null ? null : "preact",
      buildType: version === null ? null : "development",
      roots: [...roots].map((root) => getRootSnapshot(root, fragment)),
      capturedAt: new Date().toISOString(),
    }),
    commitCount: () => commits,
  };
};
