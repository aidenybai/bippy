import type {
  Fiber,
  FiberRoot,
  ReactDevToolsGlobalHook,
  ReactDevToolsTarget,
  ReactRenderer,
  Unsubscribe,
} from "bippy";

export interface ToolError {
  error: string | Error;
}

export interface TreeNode {
  firstChild: string | null;
  key: string | null;
  name: string;
  nextSibling: string | null;
  type: string;
  uid: string;
}

export interface HookNode {
  id: number | null;
  name: string;
  subHooks: HookNode[];
  value: unknown;
}

export interface SuspenderInfo {
  byteSize: number | null;
  description: unknown;
  end: number;
  environment: string | null;
  name: string;
  sourceUid: string;
  start: number;
}

export interface SuspenseDetails {
  environments: string[];
  isSuspended: boolean;
  range: [number, number] | null;
  rects: Array<{ height: number; width: number; x: number; y: number }>;
  suspendedBy: SuspenderInfo[];
  unknownSuspenders: boolean;
}

export interface SuspenseTreeNode {
  children: string[];
  details: SuspenseDetails;
  hasUniqueSuspenders: boolean;
  name: string;
  parentUid: string | null;
  uid: string;
}

export interface SuspenseTimelineStep {
  endTime: number;
  environment: string | null;
  uid: string;
}

export interface NodeInfo {
  context?: unknown;
  hooks?: HookNode[];
  key?: string;
  name: string;
  props?: Record<string, unknown>;
  state?: unknown;
  suspense?: SuspenseDetails;
  type: string;
  uid: string;
}

export interface SourceLocation {
  column: number;
  fileName: string;
  line: number;
  name: string;
}

export interface ComponentSource {
  source: SourceLocation | null;
}

export interface OwnersStack {
  stack: string;
}

export interface ComponentBranchEntry {
  name: string;
  type: string;
  uid: string;
}

export interface FindComponentsResult {
  page: number;
  pageSize: number;
  results: TreeNode[];
  totalCount: number;
  totalPages: number;
}

export interface CommitComponent {
  actualDuration: number | null;
  name: string;
  selfDuration: number | null;
  type: string;
  uid: string;
}

export interface TraceOverviewRow {
  commit: number;
  committedAt: number;
  componentsChanged: number;
  layoutDuration: number | null;
  passiveDuration: number | null;
  renderDuration: number | null;
}

export interface CommitReport {
  committedAt: number;
  components: CommitComponent[];
  layoutDuration: number | null;
  passiveDuration: number | null;
  priority: string;
  renderDuration: number | null;
}

export interface StartProfilingResult {
  status: "started";
  traceName: string;
}

export interface StopProfilingResult {
  commits: number;
  status: "stopped";
  traceName: string;
}

export interface ActionResult {
  success: true;
}

export interface ProfilingCommitRecord {
  durations: CommitComponent[];
  layoutDuration: number | null;
  passiveDuration: number | null;
  priority: string;
  renderDuration: number | null;
  timestamp: number;
}

export interface ProfilingTrace {
  commits: ProfilingCommitRecord[];
  startTime: number;
}

export interface ProfilingState {
  currentTraceName: string | null;
  isActive: boolean;
  onCommit: ((rendererId: number, root: FiberRoot, priority: number | void) => void) | null;
  onPostCommit: ((root: FiberRoot) => void) | null;
  traces: Map<string, ProfilingTrace>;
}

export interface Facade {
  dispose: Unsubscribe;
  fiberRoots: Map<number, Set<FiberRoot>>;
  getRevision: () => number;
  hook: ReactDevToolsGlobalHook;
  profilingState: ProfilingState;
  rendererInternals: Map<number, ReactRenderer>;
  subscribe: (listener: () => void) => Unsubscribe;
  target: ReactDevToolsTarget;
}

export interface TreeTools {
  findComponents: (
    name: string,
    rootUid?: string,
    page?: number,
    pageSize?: number,
  ) => FindComponentsResult | ToolError;
  getComponentByHostInstance: (hostInstance: unknown) => NodeInfo | ToolError;
  getComponentByUid: (uid: string, includeHooks?: boolean) => NodeInfo | ToolError;
  getComponentSource: (uid: string) => ComponentSource | ToolError;
  getComponentTree: (depth?: number, rootUid?: string) => TreeNode[] | ToolError;
  getOwnerStack: (uid: string) => ComponentBranchEntry[] | ToolError;
  getOwnerStackTrace: (uid: string) => OwnersStack | ToolError;
  getParentStack: (uid: string) => ComponentBranchEntry[] | ToolError;
  getFiberByUid: (uid: string) => Fiber | null;
  getUid: (fiber: Fiber) => string;
}

export interface SuspenseTools {
  getSuspenseTimeline: () => SuspenseTimelineStep[];
  getSuspenseTree: () => SuspenseTreeNode[];
  setSuspenseMilestone: (suspendedUids: string[]) => ActionResult | ToolError;
}

export interface ActionTools {
  deleteContext: (uid: string, path: Array<number | string>) => ActionResult | ToolError;
  deleteHookState: (
    uid: string,
    hookId: number,
    path: Array<number | string>,
  ) => ActionResult | ToolError;
  deleteProps: (uid: string, path: Array<number | string>) => ActionResult | ToolError;
  deleteState: (uid: string, path: Array<number | string>) => ActionResult | ToolError;
  getHostInstances: (uid: string) => unknown[] | ToolError;
  overrideContext: (
    uid: string,
    path: Array<number | string>,
    value: unknown,
  ) => ActionResult | ToolError;
  overrideHookState: (
    uid: string,
    hookId: number,
    path: Array<number | string>,
    value: unknown,
  ) => ActionResult | ToolError;
  overrideProps: (
    uid: string,
    path: Array<number | string>,
    value: unknown,
  ) => ActionResult | ToolError;
  overrideState: (
    uid: string,
    path: Array<number | string>,
    value: unknown,
  ) => ActionResult | ToolError;
  renameContext: (
    uid: string,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => ActionResult | ToolError;
  renameHookState: (
    uid: string,
    hookId: number,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => ActionResult | ToolError;
  renameProps: (
    uid: string,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => ActionResult | ToolError;
  renameState: (
    uid: string,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => ActionResult | ToolError;
  setError: (uid: string, shouldError: boolean) => ActionResult | ToolError;
  setSuspense: (uid: string, shouldSuspend: boolean) => ActionResult | ToolError;
}

export interface ProfilerTools {
  getCommitReport: (traceName: string, commitIndex: number) => CommitReport | ToolError;
  getTraceOverview: (traceName: string) => TraceOverviewRow[] | ToolError;
  startProfiling: (traceName?: string) => StartProfilingResult | ToolError;
  stopProfiling: () => StopProfilingResult | ToolError;
}

export interface Tools
  extends Omit<TreeTools, "getFiberByUid" | "getUid">, ActionTools, ProfilerTools, SuspenseTools {}

export interface ReactDevTools extends Tools {
  dispose: Unsubscribe;
  getRevision: () => number;
  subscribe: (listener: () => void) => Unsubscribe;
}
