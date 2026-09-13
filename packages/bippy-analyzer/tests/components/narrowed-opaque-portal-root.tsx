import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Headless UI's `usePortalTarget`: the portal root is looked up in the
// document (statically opaque) and created on the miss. A root that passed
// `if (existingRoot)` is truthy on that path, so the later `!target` test
// must not reopen the decision.

const PORTAL_ROOT_ID = "headlessui-portal-root";

const usePortalTarget = (): HTMLElement | null => {
  const [target] = useState<HTMLElement | null>(() => {
    const existingRoot = document.getElementById(PORTAL_ROOT_ID);
    if (existingRoot) return existingRoot;
    const root = document.createElement("div");
    root.setAttribute("id", PORTAL_ROOT_ID);
    return document.body.appendChild(root);
  });
  return target;
};

const Portal = ({ children }: { children: ReactNode }) => {
  const target = usePortalTarget();
  if (!target) return null;
  return createPortal(<div data-headlessui-portal="">{children}</div>, target);
};

export const isExact = true;

export default function NarrowedOpaquePortalRoot() {
  return (
    <main>
      <Portal>
        <p>dialog</p>
      </Portal>
    </main>
  );
}
