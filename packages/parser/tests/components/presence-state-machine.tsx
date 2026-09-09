import {
  Children,
  cloneElement,
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

type MachineState = "mounted" | "unmountSuspended" | "unmounted";
type MachineEvent = "MOUNT" | "UNMOUNT" | "ANIMATION_OUT" | "ANIMATION_END";

const MACHINE: Record<MachineState, Partial<Record<MachineEvent, MachineState>>> = {
  mounted: { UNMOUNT: "unmounted", ANIMATION_OUT: "unmountSuspended" },
  unmountSuspended: { MOUNT: "mounted", ANIMATION_END: "unmounted" },
  unmounted: { MOUNT: "mounted" },
};

const useStateMachine = (initialState: MachineState) =>
  useReducer(
    (state: MachineState, event: MachineEvent) => MACHINE[state][event] ?? state,
    initialState,
  );

const getAnimationName = (styles?: CSSStyleDeclaration): string => styles?.animationName || "none";

const usePresence = (present: boolean) => {
  const [node, setNode] = useState<HTMLElement>();
  const stylesRef = useRef<CSSStyleDeclaration>();
  const prevPresentRef = useRef(present);
  const prevAnimationNameRef = useRef("none");
  const [state, send] = useStateMachine(present ? "mounted" : "unmounted");

  useEffect(() => {
    const currentAnimationName = getAnimationName(stylesRef.current);
    prevAnimationNameRef.current = state === "mounted" ? currentAnimationName : "none";
  }, [state]);

  useLayoutEffect(() => {
    const styles = stylesRef.current;
    const wasPresent = prevPresentRef.current;
    if (wasPresent !== present) {
      const prevAnimationName = prevAnimationNameRef.current;
      const currentAnimationName = getAnimationName(styles);
      if (present) send("MOUNT");
      else if (currentAnimationName === "none" || styles?.display === "none") send("UNMOUNT");
      else if (wasPresent && prevAnimationName !== currentAnimationName) send("ANIMATION_OUT");
      else send("UNMOUNT");
      prevPresentRef.current = present;
    }
  }, [present, send]);

  useLayoutEffect(() => {
    if (node) {
      const handleAnimationEnd = (event: AnimationEvent) => {
        const currentAnimationName = getAnimationName(stylesRef.current);
        if (event.target === node && currentAnimationName.includes(event.animationName))
          flushSync(() => send("ANIMATION_END"));
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
      setNode(element ?? undefined);
    }, []),
  };
};

interface PresenceProps {
  present: boolean;
  children: ReactElement | ((props: { present: boolean }) => ReactElement);
}

const Presence = ({ present, children }: PresenceProps) => {
  const presence = usePresence(present);
  const child =
    typeof children === "function"
      ? children({ present: presence.isPresent })
      : Children.only(children);
  const forceMount = typeof children === "function";
  return forceMount || presence.isPresent ? cloneElement(child, { ref: presence.ref }) : null;
};

interface ContentProps {
  open: boolean;
  present: boolean;
  children: ReactNode;
}

const ContentImpl = forwardRef<HTMLDivElement, ContentProps>(
  ({ open, present, children }, forwardedRef) => {
    const [isPresent, setIsPresent] = useState(present);
    const ref = useRef<HTMLDivElement>(null);
    const isOpen = open || isPresent;
    useLayoutEffect(() => {
      if (ref.current) setIsPresent(present);
    }, [open, present]);
    return (
      <div
        ref={(node) => {
          ref.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
        }}
        data-state={open ? "open" : "closed"}
        hidden={!isOpen}
      >
        {isOpen && children}
      </div>
    );
  },
);

const Collapsible = ({ open, children }: { open: boolean; children: ReactNode }) => (
  <Presence present={open}>
    {({ present }) => (
      <ContentImpl open={open} present={present}>
        {children}
      </ContentImpl>
    )}
  </Presence>
);

export const isExact = true;

export default function PresenceStateMachine() {
  return (
    <section>
      <Collapsible open={false}>
        <p>closed content</p>
      </Collapsible>
      <Collapsible open>
        <p>open content</p>
      </Collapsible>
    </section>
  );
}
