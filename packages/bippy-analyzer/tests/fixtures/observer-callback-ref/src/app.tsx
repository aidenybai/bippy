import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useCallbackRef } from "./use-callback-ref";

const setRef = <Value>(ref: unknown, value: Value): void => {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object" && "current" in ref) ref.current = value;
};

const useComposedRefs = <Value>(...refs: unknown[]): ((value: Value) => void) =>
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

export const ScrollArea = ({ children }: { children: ReactNode }) => {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [isScrollbarVisible, setIsScrollbarVisible] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportRefs = useComposedRefs<HTMLDivElement | null>(
    undefined,
    viewportRef,
    setViewport,
  );
  const handleResize = useDebounceCallback(() => {
    if (viewport) setIsScrollbarVisible(viewport.offsetHeight < viewport.scrollHeight);
  }, 10);
  useResizeObserver(viewport, handleResize);
  return (
    <div className="scroll-area">
      <div className="viewport" ref={viewportRefs}>
        {children}
      </div>
      <Presence present={isScrollbarVisible}>
        <div className="scrollbar" data-state={isScrollbarVisible ? "visible" : "hidden"} />
      </Presence>
    </div>
  );
};

export const App = () => (
  <ScrollArea>
    <p>content</p>
  </ScrollArea>
);
