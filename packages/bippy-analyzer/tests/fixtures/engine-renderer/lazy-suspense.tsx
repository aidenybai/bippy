import { lazy, Suspense, use, useEffect, useLayoutEffect } from "react";

const trace: string[] = [];
let resolveData: (value: string) => void = () => {};
const data = new Promise<string>((resolve) => {
  resolveData = resolve;
});
const Content = () => {
  useLayoutEffect(() => {
    trace.push("content:layout");
    return () => {
      trace.push("content:cleanup");
    };
  }, []);
  const value = use(data);
  return <strong>{value}</strong>;
};
const LazyContent = lazy(
  () =>
    new Promise<{ default: typeof Content }>((resolve) => {
      trace.push("load");
      setTimeout(() => {
        trace.push("module");
        resolve({ default: Content });
      }, 5);
      setTimeout(() => {
        trace.push("data");
        resolveData("ready");
      }, 10);
    }),
);
const Fallback = () => {
  useEffect(() => {
    trace.push("fallback:effect");
    return () => {
      trace.push("fallback:cleanup");
    };
  }, []);
  return <span>loading</span>;
};
export default () => (
  <Suspense fallback={<Fallback />}>
    <LazyContent />
  </Suspense>
);
export const getTrace = () => trace;
