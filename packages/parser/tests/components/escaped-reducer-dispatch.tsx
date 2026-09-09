import { useCallback, useLayoutEffect, useReducer, useState } from "react";

type PresenceState = "mounted" | "unmountSuspended" | "unmounted";
type PresenceEvent = "MOUNT" | "UNMOUNT" | "ANIMATION_OUT" | "ANIMATION_END";

const machine: Record<PresenceState, Partial<Record<PresenceEvent, PresenceState>>> = {
  mounted: { UNMOUNT: "unmounted", ANIMATION_OUT: "unmountSuspended" },
  unmountSuspended: { MOUNT: "mounted", ANIMATION_END: "unmounted" },
  unmounted: { MOUNT: "mounted" },
};

/** Radix `usePresence`: `animationend` on the node dispatches an event the closed state ignores. */
const usePresence = (isPresent: boolean) => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [state, send] = useReducer(
    (current: PresenceState, event: PresenceEvent) => machine[current][event] ?? current,
    isPresent ? "mounted" : "unmounted",
  );
  useLayoutEffect(() => {
    if (!node) {
      send("ANIMATION_END");
      return;
    }
    const handleAnimationEnd = (event: AnimationEvent) => {
      if (event.target === node) send("ANIMATION_END");
    };
    node.addEventListener("animationend", handleAnimationEnd);
    node.addEventListener("animationcancel", handleAnimationEnd);
    return () => {
      node.removeEventListener("animationend", handleAnimationEnd);
      node.removeEventListener("animationcancel", handleAnimationEnd);
    };
  }, [node]);
  return {
    isPresent: state === "mounted" || state === "unmountSuspended",
    ref: useCallback((next: HTMLElement | null) => setNode(next), []),
  };
};

const Collapsible = ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => {
  const presence = usePresence(isOpen);
  return (
    <div ref={presence.ref} hidden={!presence.isPresent} data-state={isOpen ? "open" : "closed"}>
      {presence.isPresent && children}
    </div>
  );
};

export const isExact = true;

export default function EscapedReducerDispatch() {
  return (
    <section>
      <Collapsible isOpen={false}>
        <p>closed</p>
      </Collapsible>
      <Collapsible isOpen>
        <p>open</p>
      </Collapsible>
    </section>
  );
}
