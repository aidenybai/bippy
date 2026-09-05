import { createActionTools } from "./action-tools.js";
import { getFacadeRendererActions, installFacade } from "./facade.js";
import { createProfilerTools } from "./profiler-tools.js";
import { createSuspenseTools } from "./suspense-tools.js";
import { createTreeTools } from "./tree-tools.js";
import type { ReactDevToolsTarget } from "bippy";
import type { Facade, ReactDevTools, Tools } from "./types.js";

export const createTools = (facade: Facade): Tools => {
  const treeTools = createTreeTools(facade.fiberRoots, facade.target);
  const profilerTools = createProfilerTools(facade.profilingState, treeTools.getUid);
  const rendererActions = getFacadeRendererActions(facade);
  const actionTools = createActionTools(treeTools.getFiberByUid, rendererActions);
  const suspenseTools = createSuspenseTools(
    facade.fiberRoots,
    treeTools.getFiberByUid,
    treeTools.getUid,
    rendererActions.setFiberSuspense,
  );
  return {
    deleteContext: actionTools.deleteContext,
    deleteHookState: actionTools.deleteHookState,
    deleteProps: actionTools.deleteProps,
    deleteState: actionTools.deleteState,
    findComponents: treeTools.findComponents,
    getCommitReport: profilerTools.getCommitReport,
    getComponentByHostInstance: treeTools.getComponentByHostInstance,
    getComponentByUid: treeTools.getComponentByUid,
    getComponentSource: treeTools.getComponentSource,
    getComponentTree: treeTools.getComponentTree,
    getHostInstances: actionTools.getHostInstances,
    getOwnerStack: treeTools.getOwnerStack,
    getOwnerStackTrace: treeTools.getOwnerStackTrace,
    getParentStack: treeTools.getParentStack,
    getSuspenseTimeline: suspenseTools.getSuspenseTimeline,
    getSuspenseTree: suspenseTools.getSuspenseTree,
    getTraceOverview: profilerTools.getTraceOverview,
    overrideContext: actionTools.overrideContext,
    overrideHookState: actionTools.overrideHookState,
    overrideProps: actionTools.overrideProps,
    overrideState: actionTools.overrideState,
    renameContext: actionTools.renameContext,
    renameHookState: actionTools.renameHookState,
    renameProps: actionTools.renameProps,
    renameState: actionTools.renameState,
    setError: actionTools.setError,
    setSuspense: actionTools.setSuspense,
    setSuspenseMilestone: suspenseTools.setSuspenseMilestone,
    startProfiling: profilerTools.startProfiling,
    stopProfiling: profilerTools.stopProfiling,
  };
};

export const createReactDevTools = (target: ReactDevToolsTarget = globalThis): ReactDevTools => {
  const facade = installFacade(target);
  return {
    ...createTools(facade),
    dispose: facade.dispose,
    getRevision: facade.getRevision,
    subscribe: facade.subscribe,
  };
};

export { installFacade };
export * from "./mcp.js";
export type * from "./types.js";
