import * as React from "react";
import type { ReconcilerFiber, ReconcilerHostConfig } from "./types.js";

interface DispatcherRef {
  H?: unknown;
  current?: unknown;
}

interface LegacySecretInternals {
  ReactCurrentDispatcher?: DispatcherRef;
}

const getReactDispatcherRef = (): DispatcherRef => {
  const clientInternals = Reflect.get(
    React,
    "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
  );
  if (clientInternals && typeof clientInternals === "object") {
    return clientInternals;
  }
  const secretInternals: LegacySecretInternals | undefined = Reflect.get(
    React,
    "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
  );
  return secretInternals?.ReactCurrentDispatcher ?? { current: null };
};

export const reactDispatcherRef = getReactDispatcherRef();

export const setReactDispatcher = (dispatcher: unknown): void => {
  if ("H" in reactDispatcherRef) {
    reactDispatcherRef.H = dispatcher;
  } else {
    reactDispatcherRef.current = dispatcher;
  }
};

interface CurrentRef<T> {
  current: T;
}

export const currentHostConfig: CurrentRef<ReconcilerHostConfig> = { current: null! };
export const currentRootFiber: CurrentRef<ReconcilerFiber> = { current: null! };

export const FunctionComponentTag = 0;
export const ClassComponentTag = 1;
export const HostRootTag = 3;
export const HostPortalTag = 4;
export const HostComponentTag = 5;
export const HostTextTag = 6;

export const NoFlags = 0;
export const PlacementFlag = 2;
export const UpdateFlag = 4;
export const DeletionFlag = 8;

export const NoHookEffect = 0;
export const PassiveHookEffect = 1;
export const LayoutHookEffect = 2;
export const InsertionHookEffect = 3;

export const REACT_PORTAL_TYPE = Symbol.for("react.portal");
export const REACT_CONTEXT_TYPE = Symbol.for("react.context");
export const REACT_CONSUMER_TYPE = Symbol.for("react.consumer");
export const REACT_PROVIDER_TYPE = Symbol.for("react.provider");
export const REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
export const REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");

export const isComponentFiber = (fiber: ReconcilerFiber): boolean =>
  fiber.tag === FunctionComponentTag || fiber.tag === ClassComponentTag;
