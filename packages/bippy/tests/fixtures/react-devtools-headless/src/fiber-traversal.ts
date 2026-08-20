import { isFiber } from "bippy";
import type { Fiber } from "bippy";

export const getFiberChildren = (fiber: Fiber): Fiber[] => {
  const children: Fiber[] = [];
  let child = fiber.child;
  while (child) {
    children.push(child);
    child = child.sibling;
  }
  return children;
};

export const getFiberAncestors = (fiber: Fiber): Fiber[] => {
  const ancestors: Fiber[] = [];
  let parent = fiber.return;
  while (parent) {
    ancestors.push(parent);
    parent = parent.return;
  }
  return ancestors;
};

export const getFiberOwners = (fiber: Fiber): Fiber[] => {
  const owners: Fiber[] = [];
  let owner: unknown = fiber._debugOwner;
  while (owner) {
    if (isFiber(owner)) {
      owners.push(owner);
      owner = owner._debugOwner;
    } else if (typeof owner === "object") {
      owner = Reflect.get(owner, "owner");
    } else {
      owner = null;
    }
  }
  return owners;
};
