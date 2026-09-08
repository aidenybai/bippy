import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Radix's `useCallbackRef`: a stable function forwarding to the latest callback through a ref. */
const useCallbackRef = <Arguments extends unknown[]>(
  callback: (...args: Arguments) => void,
): ((...args: Arguments) => void) => {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });
  return useMemo(
    () =>
      (...args: Arguments) =>
        callbackRef.current(...args),
    [],
  );
};

/** Fires the callback once the deadline passes; the remaining delay is measured, so the timer cannot be settled. */
const useDeadlineCallback = (callback: () => void, deadline: number): (() => void) => {
  const handleCallback = useCallbackRef(callback);
  const timerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  return useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => handleCallback(),
      Math.max(0, deadline - Date.now()),
    );
  }, [handleCallback, deadline]);
};

const Deadline = ({ onReady }: { onReady: () => void }) => {
  const markReady = useDeadlineCallback(() => onReady(), 0);
  useEffect(() => {
    markReady();
  }, [markReady]);
  return <time dateTime="0" />;
};

/** The setter sits five closures away from the escaped timer callback: timer arrow → forwarder → ref → callback → parent handler. */
export default function EscapedCallbackChain() {
  const [isReady, setIsReady] = useState(false);
  return (
    <section>
      <Deadline onReady={() => setIsReady(true)} />
      {isReady ? <strong>ready</strong> : <em>waiting</em>}
    </section>
  );
}
