// Mirrors packages/react-reconciler/src/ReactWorkTags.js in facebook/react.
export const FunctionComponentTag = 0;
export const ClassComponentTag = 1;
export const HostRootTag = 3;
export const HostPortalTag = 4;
export const HostComponentTag = 5;
export const HostTextTag = 6;
export const FragmentTag = 7;
export const ModeTag = 8;
export const ContextConsumerTag = 9;
export const ContextProviderTag = 10;
export const ForwardRefTag = 11;
export const ProfilerTag = 12;
export const SuspenseComponentTag = 13;
export const MemoComponentTag = 14;
export const SimpleMemoComponentTag = 15;
export const LazyComponentTag = 16;
export const SuspenseListComponentTag = 19;
export const OffscreenComponentTag = 22;
export const HostHoistableTag = 26;
export const HostSingletonTag = 27;
export const ThrowTag = 29;
export const ViewTransitionComponentTag = 30;
export const ActivityComponentTag = 31;

export type WorkTag =
  | typeof FunctionComponentTag
  | typeof ClassComponentTag
  | typeof HostRootTag
  | typeof HostPortalTag
  | typeof HostComponentTag
  | typeof HostTextTag
  | typeof FragmentTag
  | typeof ModeTag
  | typeof ContextConsumerTag
  | typeof ContextProviderTag
  | typeof ForwardRefTag
  | typeof ProfilerTag
  | typeof SuspenseComponentTag
  | typeof MemoComponentTag
  | typeof SimpleMemoComponentTag
  | typeof LazyComponentTag
  | typeof SuspenseListComponentTag
  | typeof OffscreenComponentTag
  | typeof HostHoistableTag
  | typeof HostSingletonTag
  | typeof ThrowTag
  | typeof ViewTransitionComponentTag
  | typeof ActivityComponentTag;

export type WorkTagName =
  | "FunctionComponent"
  | "ClassComponent"
  | "HostRoot"
  | "HostPortal"
  | "HostComponent"
  | "HostText"
  | "Fragment"
  | "Mode"
  | "ContextConsumer"
  | "ContextProvider"
  | "ForwardRef"
  | "Profiler"
  | "SuspenseComponent"
  | "MemoComponent"
  | "SimpleMemoComponent"
  | "LazyComponent"
  | "SuspenseListComponent"
  | "OffscreenComponent"
  | "HostHoistable"
  | "HostSingleton"
  | "Throw"
  | "ViewTransitionComponent"
  | "ActivityComponent";

const WORK_TAG_NAMES: Record<WorkTag, WorkTagName> = {
  [FunctionComponentTag]: "FunctionComponent",
  [ClassComponentTag]: "ClassComponent",
  [HostRootTag]: "HostRoot",
  [HostPortalTag]: "HostPortal",
  [HostComponentTag]: "HostComponent",
  [HostTextTag]: "HostText",
  [FragmentTag]: "Fragment",
  [ModeTag]: "Mode",
  [ContextConsumerTag]: "ContextConsumer",
  [ContextProviderTag]: "ContextProvider",
  [ForwardRefTag]: "ForwardRef",
  [ProfilerTag]: "Profiler",
  [SuspenseComponentTag]: "SuspenseComponent",
  [MemoComponentTag]: "MemoComponent",
  [SimpleMemoComponentTag]: "SimpleMemoComponent",
  [LazyComponentTag]: "LazyComponent",
  [SuspenseListComponentTag]: "SuspenseListComponent",
  [OffscreenComponentTag]: "OffscreenComponent",
  [HostHoistableTag]: "HostHoistable",
  [HostSingletonTag]: "HostSingleton",
  [ThrowTag]: "Throw",
  [ViewTransitionComponentTag]: "ViewTransitionComponent",
  [ActivityComponentTag]: "ActivityComponent",
};

export const getWorkTagName = (tag: WorkTag): WorkTagName => WORK_TAG_NAMES[tag];

export const isHostWorkTag = (tag: number): boolean =>
  tag === HostComponentTag || tag === HostHoistableTag || tag === HostSingletonTag;

export const isCompositeWorkTag = (tag: number): boolean =>
  tag === FunctionComponentTag ||
  tag === ClassComponentTag ||
  tag === SimpleMemoComponentTag ||
  tag === ForwardRefTag ||
  tag === MemoComponentTag;
