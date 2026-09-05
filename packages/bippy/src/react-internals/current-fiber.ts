// Adapted from ReactFiberTreeReflection.js. Copyright (c) Meta Platforms, Inc. and affiliates. MIT licensed.
import type { Fiber } from "./types.js";
import { getReactWorkTagsForFiber } from "./index.js";

export const getCurrentFiberFromRoot = (fiber: Fiber): Fiber | null => {
  const alternate = fiber.alternate;
  if (!alternate) return null;
  let firstBranch = fiber;
  let secondBranch = alternate;

  while (firstBranch.return) {
    const firstParent = firstBranch.return;
    const secondParent = firstParent.alternate;
    if (!secondParent) {
      const nextParent = firstParent.return;
      if (!nextParent) return null;
      firstBranch = secondBranch = nextParent;
      continue;
    }

    if (firstParent.child === secondParent.child) {
      let child = firstParent.child;
      while (child) {
        if (child === firstBranch || child === secondBranch) {
          let root = firstParent;
          while (root.return) root = root.return;
          if (root.tag !== getReactWorkTagsForFiber(root).HostRoot) return null;
          return child === firstBranch ? fiber : alternate;
        }
        child = child.sibling;
      }
      return null;
    }

    if (firstBranch.return !== secondBranch.return) {
      firstBranch = firstParent;
      secondBranch = secondParent;
    } else {
      let didFindChild = false;
      let child = firstParent.child;
      while (child) {
        if (child === firstBranch) {
          firstBranch = firstParent;
          secondBranch = secondParent;
          didFindChild = true;
          break;
        }
        if (child === secondBranch) {
          firstBranch = secondParent;
          secondBranch = firstParent;
          didFindChild = true;
          break;
        }
        child = child.sibling;
      }
      if (!didFindChild) {
        child = secondParent.child;
        while (child) {
          if (child === firstBranch) {
            firstBranch = secondParent;
            secondBranch = firstParent;
            didFindChild = true;
            break;
          }
          if (child === secondBranch) {
            firstBranch = firstParent;
            secondBranch = secondParent;
            didFindChild = true;
            break;
          }
          child = child.sibling;
        }
        if (!didFindChild) return null;
      }
    }
    if (firstBranch.alternate !== secondBranch) return null;
  }

  if (firstBranch.tag !== getReactWorkTagsForFiber(firstBranch).HostRoot) return null;
  const root = firstBranch.stateNode;
  if (typeof root !== "object" || root === null || !("current" in root)) return null;
  if (root.current === firstBranch) return fiber;
  return root.current === secondBranch ? alternate : null;
};
