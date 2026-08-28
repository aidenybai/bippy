import {
  DeletionFlag,
  HostPortalTag,
  HostRootTag,
  HostTextTag,
  InsertionHookEffect,
  LayoutHookEffect,
  NoFlags,
  NoHookEffect,
  PassiveHookEffect,
  PlacementFlag,
  UpdateFlag,
  currentHostConfig,
  currentRootFiber,
  isComponentFiber,
} from "./constants.js";
import { startTransition } from "./scheduler.js";
import type { ReconcilerFiber, ReconcilerRoot } from "./types.js";

const commitHookEffectList = (
  fiber: ReconcilerFiber,
  effectTag: number,
  fiberFlags?: number,
): void => {
  const effectList = fiber.effects;
  if (!effectList) return;

  for (const effect of effectList) {
    if (effect.tag !== effectTag) continue;

    if (fiberFlags === DeletionFlag || !effect.deps?.length) {
      effect.destroy?.();
      effect.destroy = undefined;

      if (fiberFlags === DeletionFlag) {
        effect.tag = NoHookEffect;
        continue;
      }
    }

    effect.destroy = effect.create() ?? undefined;
    if (effect.deps?.length) effect.tag = NoHookEffect;
  }
};

const detachRefs = (fiber: ReconcilerFiber | null): void => {
  if (fiber === null) return;
  detachRefs(fiber.child);
  detachRefs(fiber.sibling);
  if (fiber.ref) {
    if (typeof fiber.ref === "function") {
      fiber.ref(null);
    } else {
      (fiber.ref as React.MutableRefObject<unknown>).current = null;
    }
    fiber.ref = null;
  }
};

const getContainerInstance = (returnFiber: ReconcilerFiber): unknown => {
  if (returnFiber.tag === HostRootTag) {
    return (returnFiber.stateNode as ReconcilerRoot).containerInfo;
  }
  return returnFiber.stateNode;
};

const commitDeletion = (fiber: ReconcilerFiber, returnFiber: ReconcilerFiber | null): void => {
  const isContainer =
    returnFiber !== null &&
    returnFiber.stateNode !== null &&
    (returnFiber.return === null || returnFiber.tag === HostPortalTag);
  const returnInstance = returnFiber === null ? null : getContainerInstance(returnFiber);

  if (fiber.stateNode !== null && !isComponentFiber(fiber)) {
    if (isContainer) {
      currentHostConfig.current.removeChildFromContainer?.(returnInstance, fiber.stateNode);
    } else {
      currentHostConfig.current.removeChild?.(returnInstance, fiber.stateNode);
    }
  } else if (fiber.child !== null) {
    commitDeletion(fiber.child, returnFiber);

    let sibling = fiber.child.sibling;
    while (sibling !== null) {
      commitDeletion(sibling, returnFiber);
      sibling = sibling.sibling;
    }
  }
  startTransition(() => commitHookEffectList(fiber, PassiveHookEffect, DeletionFlag));
  commitHookEffectList(fiber, InsertionHookEffect, DeletionFlag);
  commitHookEffectList(fiber, LayoutHookEffect, DeletionFlag);
  detachRefs(fiber);
};

const commitWork = (fiber: ReconcilerFiber | null): void => {
  if (fiber === null) return;

  let returnFiber = fiber.return;
  while (returnFiber !== null && isComponentFiber(returnFiber)) {
    returnFiber = returnFiber.return;
  }

  const isContainer =
    returnFiber !== null &&
    returnFiber.stateNode !== null &&
    (returnFiber.return === null || returnFiber.tag === HostPortalTag);
  const returnInstance = returnFiber === null ? null : getContainerInstance(returnFiber);
  const hostConfig = currentHostConfig.current;

  if (fiber.flags === PlacementFlag) {
    if (fiber.stateNode !== null && !isComponentFiber(fiber)) {
      if (
        fiber.return !== null &&
        isComponentFiber(fiber.return) &&
        fiber.return.siblingNode !== null
      ) {
        if (isContainer) {
          hostConfig.insertInContainerBefore?.(
            returnInstance,
            fiber.stateNode,
            fiber.return.siblingNode,
          );
        } else {
          hostConfig.insertBefore?.(returnInstance, fiber.stateNode, fiber.return.siblingNode);
        }
      } else {
        let nextInstance: unknown = null;
        let sibling = fiber.sibling;
        while (sibling !== null && nextInstance === null) {
          if (
            sibling.stateNode !== null &&
            !isComponentFiber(sibling) &&
            sibling.flags !== PlacementFlag
          ) {
            nextInstance = sibling.stateNode;
            break;
          }
          sibling = sibling.sibling;
        }
        if (nextInstance !== null) {
          if (isContainer) {
            hostConfig.insertInContainerBefore?.(returnInstance, fiber.stateNode, nextInstance);
          } else {
            hostConfig.insertBefore?.(returnInstance, fiber.stateNode, nextInstance);
          }
        } else if (isContainer) {
          hostConfig.appendChildToContainer?.(returnInstance, fiber.stateNode);
        } else {
          (hostConfig.appendChild ?? hostConfig.appendInitialChild)?.(
            returnInstance,
            fiber.stateNode,
          );
        }
      }

      const rootContainerInfo = (currentRootFiber.current.stateNode as ReconcilerRoot)
        .containerInfo;
      if (
        hostConfig.finalizeInitialChildren(
          fiber.stateNode,
          fiber.type,
          fiber.pendingProps,
          rootContainerInfo,
          null,
        )
      ) {
        hostConfig.commitMount?.(fiber.stateNode, fiber.type, fiber.pendingProps, fiber);
      }
    }
  } else if (fiber.flags === DeletionFlag) {
    commitDeletion(fiber, returnFiber);
  } else if (fiber.flags === UpdateFlag) {
    if (fiber.tag === HostTextTag) {
      if (fiber.alternate?.pendingProps.text !== fiber.pendingProps.text) {
        hostConfig.commitTextUpdate?.(
          fiber.stateNode,
          String(fiber.alternate?.pendingProps.text ?? ""),
          String(fiber.pendingProps.text),
        );
      }
    } else if (!isComponentFiber(fiber) && fiber.tag !== HostPortalTag) {
      const prevProps = fiber.alternate?.pendingProps ?? {};
      if (hostConfig.prepareUpdate) {
        const rootContainerInfo = (currentRootFiber.current.stateNode as ReconcilerRoot)
          .containerInfo;
        const updatePayload = hostConfig.prepareUpdate(
          fiber.stateNode,
          fiber.type,
          prevProps,
          fiber.pendingProps,
          rootContainerInfo,
          null,
        );
        if (updatePayload !== null) {
          hostConfig.commitUpdate?.(
            fiber.stateNode,
            updatePayload,
            fiber.type,
            prevProps,
            fiber.pendingProps,
            fiber,
          );
        }
      } else {
        hostConfig.commitUpdate?.(fiber.stateNode, fiber.type, prevProps, fiber.pendingProps, fiber);
      }
    }
  }

  const committedFlags = fiber.flags;
  fiber.flags = NoFlags;
  fiber.memoizedProps = fiber.pendingProps;
  commitWork(fiber.child);
  commitWork(fiber.sibling);

  if (fiber.ref && committedFlags !== DeletionFlag) {
    const publicInstance =
      fiber.stateNode === null || isComponentFiber(fiber)
        ? (fiber.stateNode ?? null)
        : currentHostConfig.current.getPublicInstance(fiber.stateNode);
    if (typeof fiber.ref === "function") {
      fiber.ref(publicInstance);
    } else {
      (fiber.ref as React.MutableRefObject<unknown>).current = publicInstance;
    }
  }

  startTransition(() => commitHookEffectList(fiber, PassiveHookEffect, committedFlags));
  commitHookEffectList(fiber, InsertionHookEffect, committedFlags);
  commitHookEffectList(fiber, LayoutHookEffect, committedFlags);
};

export const commitRoot = (
  workInProgressRoot: ReconcilerFiber,
  deletions: ReconcilerFiber[],
): void => {
  for (const deletedFiber of deletions) commitWork(deletedFiber);
  startTransition(() => commitHookEffectList(workInProgressRoot, PassiveHookEffect));
  commitHookEffectList(workInProgressRoot, InsertionHookEffect);
  commitHookEffectList(workInProgressRoot, LayoutHookEffect);
  commitWork(workInProgressRoot.child);
  deletions.length = 0;

  workInProgressRoot.flags = NoFlags;
  workInProgressRoot.memoizedProps = workInProgressRoot.pendingProps;

  if (workInProgressRoot.tag === HostRootTag) {
    const root = workInProgressRoot.stateNode as ReconcilerRoot;
    workInProgressRoot.memoizedState = { element: root.pendingChildren };
    root.current = workInProgressRoot;
    root.onCommit?.(root);
  } else {
    const root = currentRootFiber.current.stateNode as ReconcilerRoot;
    root.onCommit?.(root);
  }
};
