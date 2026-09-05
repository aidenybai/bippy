import type { Fiber } from "bippy";
import type { RendererActions } from "./renderer-actions.js";
import type { ActionResult, ActionTools, ToolError } from "./types.js";

const runAction = (
  getFiberByUid: (uid: string) => Fiber | null,
  uid: string,
  actionName: string,
  action: (fiber: Fiber) => boolean,
): ActionResult | ToolError => {
  const fiber = getFiberByUid(uid);
  if (!fiber) return { error: `Component not found: "${uid}"` };
  return action(fiber) ? { success: true } : { error: `Renderer does not support ${actionName}` };
};

export const createActionTools = (
  getFiberByUid: (uid: string) => Fiber | null,
  rendererActions: RendererActions,
): ActionTools => ({
  deleteContext: (uid, path) =>
    runAction(getFiberByUid, uid, "context deletion", (fiber) =>
      rendererActions.deleteFiberContext(fiber, path),
    ),
  deleteHookState: (uid, hookId, path) =>
    runAction(getFiberByUid, uid, "hook state deletion", (fiber) =>
      rendererActions.deleteFiberHookState(fiber, hookId, path),
    ),
  deleteProps: (uid, path) =>
    runAction(getFiberByUid, uid, "prop deletion", (fiber) =>
      rendererActions.deleteFiberProps(fiber, path),
    ),
  deleteState: (uid, path) =>
    runAction(getFiberByUid, uid, "state deletion", (fiber) =>
      rendererActions.deleteFiberState(fiber, path),
    ),
  getHostInstances: (uid) => {
    const fiber = getFiberByUid(uid);
    return fiber
      ? rendererActions.getHostInstances(fiber)
      : { error: `Component not found: "${uid}"` };
  },
  overrideContext: (uid, path, value) =>
    runAction(getFiberByUid, uid, "context overrides", (fiber) =>
      rendererActions.overrideFiberContext(fiber, path, value),
    ),
  overrideHookState: (uid, hookId, path, value) =>
    runAction(getFiberByUid, uid, "hook state overrides", (fiber) =>
      rendererActions.overrideFiberHookState(fiber, hookId, path, value),
    ),
  overrideProps: (uid, path, value) =>
    runAction(getFiberByUid, uid, "prop overrides", (fiber) =>
      rendererActions.overrideFiberProps(fiber, path, value),
    ),
  overrideState: (uid, path, value) =>
    runAction(getFiberByUid, uid, "state overrides", (fiber) =>
      rendererActions.overrideFiberState(fiber, path, value),
    ),
  renameContext: (uid, oldPath, newPath) =>
    runAction(getFiberByUid, uid, "context renaming", (fiber) =>
      rendererActions.renameFiberContext(fiber, oldPath, newPath),
    ),
  renameHookState: (uid, hookId, oldPath, newPath) =>
    runAction(getFiberByUid, uid, "hook state renaming", (fiber) =>
      rendererActions.renameFiberHookState(fiber, hookId, oldPath, newPath),
    ),
  renameProps: (uid, oldPath, newPath) =>
    runAction(getFiberByUid, uid, "prop renaming", (fiber) =>
      rendererActions.renameFiberProps(fiber, oldPath, newPath),
    ),
  renameState: (uid, oldPath, newPath) =>
    runAction(getFiberByUid, uid, "state renaming", (fiber) =>
      rendererActions.renameFiberState(fiber, oldPath, newPath),
    ),
  setError: (uid, shouldError) =>
    runAction(getFiberByUid, uid, "error overrides", (fiber) =>
      rendererActions.setFiberError(fiber, shouldError),
    ),
  setSuspense: (uid, shouldSuspend) =>
    runAction(getFiberByUid, uid, "Suspense overrides", (fiber) =>
      rendererActions.setFiberSuspense(fiber, shouldSuspend),
    ),
});
