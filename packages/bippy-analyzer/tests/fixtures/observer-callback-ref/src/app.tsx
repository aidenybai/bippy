import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useCallbackRef } from "./use-callback-ref";

interface ScrollAreaContextValue {
  viewport: HTMLDivElement | null;
  onViewportChange: (viewport: HTMLDivElement | null) => void;
}

const ScrollAreaContext = createContext<ScrollAreaContextValue | null>(null);

const getScrollAreaContext = (): ScrollAreaContextValue => {
  const context = useContext(ScrollAreaContext);
  if (!context) throw new Error("Missing scroll area context");
  return context;
};

const setRef = <Value,>(ref: unknown, value: Value): void => {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object" && "current" in ref) ref.current = value;
};

const useComposedRefs = <Value,>(...refs: unknown[]): ((value: Value) => void) =>
  useCallback((value: Value) => refs.forEach((ref) => setRef(ref, value)), refs);

const useDebounceCallback = (callback: () => void, delay: number): (() => void) => {
  const handleCallback = useCallbackRef(callback);
  const debounceTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(debounceTimerRef.current), []);
  return useCallback(() => {
    window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(handleCallback, delay);
  }, [handleCallback, delay]);
};

const useResizeObserver = (element: HTMLElement | null, onResize: () => void): void => {
  const handleResize = useCallbackRef(onResize);
  useLayoutEffect(() => {
    let frame = 0;
    if (element) {
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(handleResize);
      });
      resizeObserver.observe(element);
      return () => {
        window.cancelAnimationFrame(frame);
        resizeObserver.unobserve(element);
      };
    }
  }, [element, handleResize]);
};

const Presence = ({ present, children }: { present: boolean; children: ReactNode }) =>
  present ? <>{children}</> : null;

const ScrollArea = ({ children }: { children: ReactNode }) => {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <ScrollAreaContext.Provider value={{ viewport, onViewportChange: setViewport }}>
      <div className="scroll-area">{children}</div>
    </ScrollAreaContext.Provider>
  );
};

const Viewport = ({ children }: { children: ReactNode }) => {
  const context = getScrollAreaContext();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportRefs = useComposedRefs<HTMLDivElement | null>(
    undefined,
    viewportRef,
    context.onViewportChange,
  );
  return (
    <div className="viewport" ref={viewportRefs}>
      {children}
    </div>
  );
};

const Scrollbar = () => {
  const context = getScrollAreaContext();
  const [isScrollbarVisible, setIsScrollbarVisible] = useState(false);
  const handleResize = useDebounceCallback(() => {
    if (context.viewport) {
      setIsScrollbarVisible(context.viewport.offsetHeight < context.viewport.scrollHeight);
    }
  }, 10);
  useResizeObserver(context.viewport, handleResize);
  return (
    <Presence present={isScrollbarVisible}>
      <div className="scrollbar" data-state={isScrollbarVisible ? "visible" : "hidden"} />
    </Presence>
  );
};

export const App = () => (
  <ScrollArea>
    <Viewport>
      <p>content</p>
    </Viewport>
    <Scrollbar />
  </ScrollArea>
);
