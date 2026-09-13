import { useEffect, useReducer, useState } from "react";
import { EventEmitter } from "./shared/node-events";

type PresenceState = "mounted" | "unmountSuspended" | "unmounted";
type PresenceEvent = "MOUNT" | "UNMOUNT" | "ANIMATION_OUT" | "ANIMATION_END";

const MACHINE: Record<PresenceState, Partial<Record<PresenceEvent, PresenceState>>> = {
  mounted: { UNMOUNT: "unmounted", ANIMATION_OUT: "unmountSuspended" },
  unmountSuspended: { MOUNT: "mounted", ANIMATION_END: "unmounted" },
  unmounted: { MOUNT: "mounted" },
};

const reducer = (state: PresenceState, event: PresenceEvent): PresenceState =>
  MACHINE[state][event] ?? state;

const animations = new EventEmitter();

/** Radix `usePresence`: a mounted machine ignores `ANIMATION_END`, so the listener cannot move it. */
const Presence = ({ children }: { children: string }) => {
  const [state, send] = useReducer(reducer, "mounted");
  useEffect(() => {
    const handleAnimationEnd = () => send("ANIMATION_END");
    animations.on("animationend", handleAnimationEnd);
    return () => {
      animations.off("animationend", handleAnimationEnd);
    };
  }, []);
  return ["mounted", "unmountSuspended"].includes(state) ? <b>{children}</b> : null;
};

/** The same machine handed `MOUNT` from outside may leave `unmounted`, and a setter handed over as a value may be called with anything. */
const Toggle = () => {
  const [state, send] = useReducer(reducer, "unmounted");
  const [count, setCount] = useState(0);
  useEffect(() => {
    animations.on("mount", () => send("MOUNT"));
    animations.on("count", setCount);
  }, []);
  return (
    <p>
      {state === "unmounted" ? <s>hidden</s> : <u>shown</u>}
      {count === 0 ? <i>zero</i> : <em>{count}</em>}
    </p>
  );
};

export default function EscapedReducerDispatch() {
  return (
    <section>
      <Presence>present</Presence>
      <Toggle />
    </section>
  );
}

export const isPartial = true;
