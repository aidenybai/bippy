import { useEffect, useMemo, useRef } from "react";

export const useCallbackRef = <Arguments extends unknown[]>(
  callback: ((...args: Arguments) => void) | undefined,
): ((...args: Arguments) => void) => {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });
  return useMemo(
    () =>
      (...args: Arguments) => {
        let currentCallback;
        return (currentCallback = callbackRef.current) === null || currentCallback === undefined
          ? undefined
          : currentCallback.call(callbackRef, ...args);
      },
    [],
  );
};
