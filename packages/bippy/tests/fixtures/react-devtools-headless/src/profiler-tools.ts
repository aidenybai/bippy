import { didFiberRender } from "bippy";
import type { Fiber, FiberRoot } from "bippy";
import { getFiberDisplayName, getFiberTypeName } from "./fiber-metadata.js";
import { getFiberChildren } from "./fiber-traversal.js";
import type {
  CommitComponent,
  CommitReport,
  ProfilerTools,
  ProfilingCommitRecord,
  ProfilingState,
  ProfilingTrace,
  StartProfilingResult,
  StopProfilingResult,
  ToolError,
  TraceOverviewRow,
} from "./types.js";

const getPriorityName = (priority: number | void): string => {
  switch (priority) {
    case 1:
    case 99:
      return "Sync";
    case 2:
    case 98:
      return "UserBlocking";
    case 3:
    case 97:
      return "Normal";
    case 5:
    case 95:
      return "Idle";
    default:
      return "Normal";
  }
};

const shouldIncludeFiber = (fiber: Fiber): boolean => {
  const typeName = getFiberTypeName(fiber);
  return (
    typeName !== "dehydrated" &&
    typeName !== "fragment" &&
    typeName !== "mode" &&
    typeName !== "offscreen" &&
    typeName !== "text" &&
    typeName !== "unknown"
  );
};

const collectDurations = (
  fiber: Fiber,
  getUid: (fiber: Fiber) => string,
  durations: CommitComponent[],
): void => {
  const displayName = getFiberDisplayName(fiber);
  if (displayName && shouldIncludeFiber(fiber) && didFiberRender(fiber)) {
    const actualDuration = fiber.actualDuration ?? null;
    let selfDuration = actualDuration;
    if (actualDuration !== null) {
      selfDuration = actualDuration;
      for (const child of getFiberChildren(fiber)) {
        selfDuration -= child.actualDuration ?? 0;
      }
    }
    durations.push({
      actualDuration,
      name: displayName,
      selfDuration,
      type: getFiberTypeName(fiber),
      uid: getUid(fiber),
    });
  }

  for (const child of getFiberChildren(fiber)) {
    collectDurations(child, getUid, durations);
  }
};

export const createProfilerTools = (
  profilingState: ProfilingState,
  getUid: (fiber: Fiber) => string,
): ProfilerTools => {
  const pendingPassiveCommits = new Map<FiberRoot, ProfilingCommitRecord>();

  const startProfiling = (traceName?: string): StartProfilingResult | ToolError => {
    if (profilingState.isActive) {
      return { error: `Already profiling trace "${profilingState.currentTraceName ?? ""}"` };
    }

    const resolvedTraceName = traceName ?? `trace-${Date.now()}`;
    const trace: ProfilingTrace = { commits: [], startTime: Date.now() };
    profilingState.traces.set(resolvedTraceName, trace);
    profilingState.currentTraceName = resolvedTraceName;
    profilingState.isActive = true;
    profilingState.onCommit = (_rendererId, root, priority) => {
      const durations: CommitComponent[] = [];
      collectDurations(root.current, getUid, durations);
      const record: ProfilingCommitRecord = {
        durations,
        layoutDuration: root.effectDuration ?? null,
        passiveDuration: null,
        priority: getPriorityName(priority),
        renderDuration: root.current.actualDuration ?? null,
        timestamp: Date.now(),
      };
      trace.commits.push(record);
      pendingPassiveCommits.set(root, record);
    };
    profilingState.onPostCommit = (root) => {
      const record = pendingPassiveCommits.get(root);
      if (!record) return;
      record.passiveDuration = root.passiveEffectDuration ?? null;
      pendingPassiveCommits.delete(root);
    };

    return { status: "started", traceName: resolvedTraceName };
  };

  const stopProfiling = (): StopProfilingResult | ToolError => {
    if (!profilingState.isActive) return { error: "Not currently profiling" };
    const traceName = profilingState.currentTraceName;
    if (!traceName) return { error: "No active trace" };
    const commits = profilingState.traces.get(traceName)?.commits.length ?? 0;
    profilingState.currentTraceName = null;
    profilingState.isActive = false;
    profilingState.onCommit = null;
    profilingState.onPostCommit = null;
    pendingPassiveCommits.clear();
    return { commits, status: "stopped", traceName };
  };

  const getTrace = (traceName: string): ProfilingTrace | null =>
    profilingState.traces.get(traceName) ?? null;

  const getTraceOverview = (traceName: string): TraceOverviewRow[] | ToolError => {
    const trace = getTrace(traceName);
    if (!trace) return { error: `Unknown trace "${traceName}"` };
    return trace.commits.map((commit, commitIndex) => ({
      commit: commitIndex,
      committedAt: commit.timestamp - trace.startTime,
      componentsChanged: commit.durations.length,
      layoutDuration: commit.layoutDuration,
      passiveDuration: commit.passiveDuration,
      renderDuration: commit.renderDuration,
    }));
  };

  const getCommitReport = (traceName: string, commitIndex: number): CommitReport | ToolError => {
    const trace = getTrace(traceName);
    if (!trace) return { error: `Unknown trace "${traceName}"` };
    const commit = trace.commits[commitIndex];
    if (!commit || commitIndex < 0) return { error: "Commit index out of range" };
    return {
      committedAt: commit.timestamp - trace.startTime,
      components: commit.durations
        .slice()
        .sort(
          (leftComponent, rightComponent) =>
            (rightComponent.actualDuration ?? 0) - (leftComponent.actualDuration ?? 0),
        ),
      layoutDuration: commit.layoutDuration,
      passiveDuration: commit.passiveDuration,
      priority: commit.priority,
      renderDuration: commit.renderDuration,
    };
  };

  return {
    getCommitReport,
    getTraceOverview,
    startProfiling,
    stopProfiling,
  };
};
