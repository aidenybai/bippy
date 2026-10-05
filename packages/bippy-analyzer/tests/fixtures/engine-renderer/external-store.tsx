import { useEffect, useSyncExternalStore } from "react";

let count = 0;
const listeners = new Set<() => void>();
const trace: string[] = [];
export const getTrace = () => trace.slice();
const subscribe = (notify: () => void) => {
  trace.push("subscribe");
  listeners.add(notify);
  return () => {
    trace.push("unsubscribe");
    listeners.delete(notify);
  };
};
const getSnapshot = () => count;
const ExternalStore = () => {
  const value = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    count = 7;
    for (const notify of listeners) notify();
  }, []);
  return <output>{value}</output>;
};
export default ExternalStore;
