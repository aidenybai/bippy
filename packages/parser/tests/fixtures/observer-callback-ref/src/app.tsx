import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const useCallbackRef = <Arguments extends unknown[]>(
  callback: ((...args: Arguments) => void) | undefined,
): ((...args: Arguments) => void) => {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });
  return useMemo(
    () =>
      (...args: Arguments) =>
        callbackRef.current?.(...args),
    [],
  );
};

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
  const handleResize = useDebounceCallback(() => {
    if (viewport) setIsScrollbarVisible(viewport.offsetHeight < viewport.scrollHeight);
  }, 10);
  useResizeObserver(viewport, handleResize);
  return (
    <div className="scroll-area">
      <div className="viewport" ref={setViewport}>
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
