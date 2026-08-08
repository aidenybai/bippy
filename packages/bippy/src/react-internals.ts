export {
  ActivityComponentTag,
  ClassComponentTag,
  ContextConsumerTag,
  DehydratedSuspenseComponentTag,
  ForwardRefTag,
  FragmentTag,
  FunctionComponentTag,
  getReactWorkTags,
  HostComponentTag,
  HostHoistableTag,
  HostPortalTag,
  HostRootTag,
  HostSingletonTag,
  HostTextTag,
  LazyComponentTag,
  LegacyHiddenComponentTag,
  MemoComponentTag,
  ModernReactWorkTags,
  OffscreenComponentTag,
  React17WorkTags,
  SimpleMemoComponentTag,
  SuspenseComponentTag,
  SuspenseListComponentTag,
  ViewTransitionComponentTag,
} from "./generated/react-work-tags.js";
export type {
  HostWorkTag,
  ModernReactWorkTag,
  ReactWorkTags,
} from "./generated/react-work-tags.js";

// HACK: React does not export Fiber flags. Keep these values aligned with ReactFiberFlags.
export const ReactFiberFlags = Object.freeze({
  ChildDeletion: 0b10000,
  Cloned: 0b1000,
  ContentReset: 0b100000,
  Hydrating: 0b1000000000000,
  PerformedWork: 0b1,
  Placement: 0b10,
  Snapshot: 0b10000000000,
  Update: 0b100,
  Visibility: 0b10000000000000,
});

export const ReactBuildType = Object.freeze({
  Development: 1,
  Production: 0,
});

export const MutationMask =
  ReactFiberFlags.Placement |
  ReactFiberFlags.Update |
  ReactFiberFlags.ChildDeletion |
  ReactFiberFlags.ContentReset |
  ReactFiberFlags.Hydrating |
  ReactFiberFlags.Visibility |
  ReactFiberFlags.Snapshot;

// HACK: React does not export its legacy mode and element symbols, which differ between React 17, 18, and 19.
export const CONCURRENT_MODE_NUMBER = 0xeacf;
export const ELEMENT_TYPE_SYMBOL_STRING = "Symbol(react.element)";
export const TRANSITIONAL_ELEMENT_TYPE_SYMBOL_STRING = "Symbol(react.transitional.element)";
export const CONCURRENT_MODE_SYMBOL_STRING = "Symbol(react.concurrent_mode)";
export const DEPRECATED_ASYNC_MODE_SYMBOL_STRING = "Symbol(react.async_mode)";
export const CONCURRENT_MODE_SYMBOL_DESCRIPTION = "react.concurrent_mode";
export const DEPRECATED_ASYNC_MODE_SYMBOL_DESCRIPTION = "react.async_mode";
