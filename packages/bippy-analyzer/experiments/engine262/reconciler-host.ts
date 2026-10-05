import { createContext, type ReactNode } from "react";
import Reconciler from "react-reconciler";
import {
  ConcurrentRoot,
  DefaultEventPriority,
  NoEventPriority,
} from "react-reconciler/constants.js";

export interface HostNode {
  kind: "host" | "text";
  type: string;
  text: string;
  props: Record<string, unknown>;
  children: HostNode[];
  hidden: boolean;
}

interface HostContainer {
  children: HostNode[];
}

export interface HostSnapshot {
  type: string;
  text?: string;
  props?: Record<string, string | number | bigint | boolean | null>;
  children?: HostSnapshot[];
}

export interface ReconcilerObservation {
  commits: HostSnapshot[][];
  tree: HostSnapshot[];
  errors: string[];
  caughtErrors: string[];
}

const appendChild = (parent: HostContainer, child: HostNode): void => {
  const index = parent.children.indexOf(child);
  if (index !== -1) parent.children.splice(index, 1);
  parent.children.push(child);
};

const removeChild = (parent: HostContainer, child: HostNode): void => {
  const index = parent.children.indexOf(child);
  if (index === -1) throw new Error("Cannot remove a missing host child");
  parent.children.splice(index, 1);
};

const insertBefore = (parent: HostContainer, child: HostNode, before: HostNode): void => {
  if (child === before) return;
  const previousIndex = parent.children.indexOf(child);
  if (previousIndex !== -1) parent.children.splice(previousIndex, 1);
  const index = parent.children.indexOf(before);
  if (index === -1) throw new Error("Cannot insert before a missing host child");
  parent.children.splice(index, 0, child);
};

const snapshot = (parent: HostContainer): HostSnapshot[] =>
  parent.children
    .filter((child) => !child.hidden)
    .map((child) => {
      if (child.kind === "text") return { type: "#text", text: child.text };
      const props: Record<string, string | number | bigint | boolean | null> = {};
      for (const [name, value] of Object.entries(child.props)) {
        if (name === "children" || name === "ref" || name.startsWith("on")) continue;
        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "bigint" ||
          typeof value === "boolean"
        )
          props[name] = value;
      }
      return { type: child.type, props, children: snapshot(child) };
    });

export const serializeReconcilerObservation = (
  observation: ReconcilerObservation,
  trace: unknown,
): string => {
  if (!Array.isArray(trace)) throw new TypeError("Reconciler traces must be arrays");
  const scalarTrace: unknown[] = Array.from(trace);
  if (
    scalarTrace.some(
      (value) =>
        value !== null &&
        !["string", "number", "bigint", "boolean", "undefined"].includes(typeof value),
    )
  )
    throw new TypeError("Reconciler traces must contain only scalar values");
  return JSON.stringify({ ...observation, trace: scalarTrace }, (_key, value: unknown) => {
    if (value === undefined) return { $scalar: "undefined" };
    if (typeof value === "bigint") return { $scalar: "bigint", value: String(value) };
    if (typeof value === "number") {
      if (Object.is(value, -0)) return { $scalar: "-0" };
      if (!Number.isFinite(value)) return { $scalar: String(value) };
    }
    return value;
  });
};

const findHost = (parent: HostContainer, type: string): HostNode | undefined => {
  for (const child of parent.children) {
    if (child.hidden) continue;
    if (child.type === type) return child;
    const nested = findHost(child, type);
    if (nested) return nested;
  }
  return undefined;
};

const unsupportedHostOperation = (): never => {
  throw new Error("Unsupported experimental reconciler host operation");
};
const noop = (): void => {};

export const createReconcilerHost = () => {
  const container: HostContainer = { children: [] };
  const commits: HostSnapshot[][] = [];
  const errors: string[] = [];
  const caughtErrors: string[] = [];
  let priority = NoEventPriority;
  const config = {
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    supportsMicrotasks: true,
    isPrimaryRenderer: true,
    getRootHostContext: () => null,
    getChildHostContext: () => null,
    getPublicInstance: (instance: HostNode) => instance,
    prepareForCommit: () => null,
    resetAfterCommit: () => {
      commits.push(snapshot(container));
    },
    createInstance: (type: string, props: Record<string, unknown>): HostNode => ({
      kind: "host",
      type,
      props,
      text: "",
      children: [],
      hidden: false,
    }),
    createTextInstance: (text: string): HostNode => ({
      kind: "text",
      type: "",
      props: {},
      text,
      children: [],
      hidden: false,
    }),
    appendInitialChild: appendChild,
    appendChild,
    appendChildToContainer: appendChild,
    insertBefore,
    insertInContainerBefore: insertBefore,
    removeChild,
    removeChildFromContainer: removeChild,
    finalizeInitialChildren: () => false,
    shouldSetTextContent: () => false,
    commitUpdate: (
      instance: HostNode,
      _type: string,
      _previous: Record<string, unknown>,
      props: Record<string, unknown>,
    ) => {
      instance.props = props;
    },
    commitTextUpdate: (instance: HostNode, _previous: string, text: string) => {
      instance.text = text;
    },
    clearContainer: (target: HostContainer) => {
      target.children.length = 0;
    },
    hideInstance: (instance: HostNode) => {
      instance.hidden = true;
    },
    hideTextInstance: (instance: HostNode) => {
      instance.hidden = true;
    },
    unhideInstance: (instance: HostNode) => {
      instance.hidden = false;
    },
    unhideTextInstance: (instance: HostNode) => {
      instance.hidden = false;
    },
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    scheduleMicrotask: queueMicrotask,
    noTimeout: -1,
    getInstanceFromNode: () => null,
    beforeActiveInstanceBlur: noop,
    afterActiveInstanceBlur: noop,
    preparePortalMount: noop,
    prepareScopeUpdate: unsupportedHostOperation,
    getInstanceFromScope: unsupportedHostOperation,
    detachDeletedInstance: noop,
    setCurrentUpdatePriority: (value: number) => {
      priority = value;
    },
    getCurrentUpdatePriority: () => priority,
    resolveUpdatePriority: () => priority || DefaultEventPriority,
    shouldAttemptEagerTransition: () => false,
    trackSchedulerEvent: noop,
    resolveEventType: () => null,
    resolveEventTimeStamp: () => -1,
    requestPostPaintCallback: (callback: (time: number) => void) => {
      setTimeout(() => callback(performance.now()), 0);
    },
    maySuspendCommit: () => false,
    maySuspendCommitOnUpdate: () => false,
    maySuspendCommitInSyncRender: () => false,
    preloadInstance: () => true,
    startSuspendingCommit: noop,
    suspendInstance: unsupportedHostOperation,
    suspendOnActiveViewTransition: noop,
    waitForCommitToBeReady: () => null,
    NotPendingTransition: null,
    HostTransitionContext: createContext(null) as unknown as Reconciler.ReactContext<null>,
    resetFormInstance: unsupportedHostOperation,
  };
  const renderer = Reconciler<
    string,
    Record<string, unknown>,
    HostContainer,
    HostNode,
    HostNode,
    never,
    never,
    never,
    HostNode,
    null,
    never,
    ReturnType<typeof setTimeout>,
    number,
    null
  >(config);
  const describeError = (error: unknown): string =>
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const root = renderer.createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    "",
    (error) => {
      errors.push(describeError(error));
    },
    (error) => {
      caughtErrors.push(describeError(error));
    },
    (error) => {
      errors.push(describeError(error));
    },
    noop,
  );
  const flush = (run: () => void): void => {
    renderer.flushSyncFromReconciler(run);
    renderer.flushPassiveEffects();
  };
  return {
    render: (node: ReactNode) => flush(() => renderer.updateContainer(node, root, null, null)),
    fire: (type: string, event: string) =>
      flush(() => {
        const instance = findHost(container, type);
        if (!instance) throw new Error(`Missing host instance: ${type}`);
        const callback = instance.props[event];
        if (typeof callback !== "function") throw new Error(`Missing host callback: ${event}`);
        callback({ target: instance, currentTarget: instance });
      }),
    unmount: () => flush(() => renderer.updateContainer(null, root, null, null)),
    observe: (): ReconcilerObservation => ({
      tree: snapshot(container),
      commits,
      errors,
      caughtErrors,
    }),
  };
};
