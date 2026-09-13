import {
  Children,
  type ReactElement,
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

type PresenceState = "mounted" | "unmountSuspended" | "unmounted";
type PresenceEvent = "MOUNT" | "UNMOUNT" | "ANIMATION_OUT" | "ANIMATION_END";
type Machine = Record<PresenceState, Partial<Record<PresenceEvent, PresenceState>>>;

const MACHINE: Machine = {
  mounted: { UNMOUNT: "unmounted", ANIMATION_OUT: "unmountSuspended" },
  unmountSuspended: { MOUNT: "mounted", ANIMATION_END: "unmounted" },
  unmounted: { MOUNT: "mounted" },
};

const useStateMachine = (initialState: PresenceState, machine: Machine) =>
  useReducer(
    (state: PresenceState, event: PresenceEvent): PresenceState => machine[state][event] ?? state,
    initialState,
  );

const getAnimationName = (styles: CSSStyleDeclaration | undefined): string =>
  styles?.animationName || "none";

/** Radix's `usePresence`: a state machine that keeps an exiting child mounted while it animates out. */
const usePresence = (present: boolean) => {
  const [node, setNode] = useState<HTMLElement | null>();
  const stylesRef = useRef<CSSStyleDeclaration | undefined>(undefined);
  const prevPresentRef = useRef(present);
  const prevAnimationNameRef = useRef("none");
  const initialState: PresenceState = present ? "mounted" : "unmounted";
  const [state, send] = useStateMachine(initialState, MACHINE);

  useEffect(() => {
    const currentAnimationName = getAnimationName(stylesRef.current);
    prevAnimationNameRef.current = state === "mounted" ? currentAnimationName : "none";
  }, [state]);

  useLayoutEffect(() => {
    const styles = stylesRef.current;
    const wasPresent = prevPresentRef.current;
    const hasPresentChanged = wasPresent !== present;
    if (hasPresentChanged) {
      const prevAnimationName = prevAnimationNameRef.current;
      const currentAnimationName = getAnimationName(styles);
      if (present) send("MOUNT");
      else if (currentAnimationName === "none" || styles?.display === "none") send("UNMOUNT");
      else {
        const isAnimating = prevAnimationName !== currentAnimationName;
        if (wasPresent && isAnimating) send("ANIMATION_OUT");
        else send("UNMOUNT");
      }
      prevPresentRef.current = present;
    }
  }, [present, send]);

  useLayoutEffect(() => {
    if (node) {
      const handleAnimationEnd = (event: AnimationEvent) => {
        const currentAnimationName = getAnimationName(stylesRef.current);
        const isCurrentAnimation = currentAnimationName.includes(event.animationName);
        if (event.target === node && isCurrentAnimation) send("ANIMATION_END");
      };
      const handleAnimationStart = (event: AnimationEvent) => {
        if (event.target === node)
          prevAnimationNameRef.current = getAnimationName(stylesRef.current);
      };
      node.addEventListener("animationstart", handleAnimationStart);
      node.addEventListener("animationcancel", handleAnimationEnd);
      node.addEventListener("animationend", handleAnimationEnd);
      return () => {
        node.removeEventListener("animationstart", handleAnimationStart);
        node.removeEventListener("animationcancel", handleAnimationEnd);
        node.removeEventListener("animationend", handleAnimationEnd);
      };
    }
    send("ANIMATION_END");
  }, [node, send]);

  return {
    isPresent: ["mounted", "unmountSuspended"].includes(state),
    ref: useCallback((element: HTMLElement | null) => {
      if (element) stylesRef.current = getComputedStyle(element);
      setNode(element);
    }, []),
  };
};

export const Presence = ({ present, children }: { present: boolean; children: ReactElement }) => {
  const presence = usePresence(present);
  const child = Children.only(children);
  return presence.isPresent ? cloneElement(child, { ref: presence.ref }) : null;
};
