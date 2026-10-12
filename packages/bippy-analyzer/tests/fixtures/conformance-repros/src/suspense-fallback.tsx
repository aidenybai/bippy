import { Suspense, Suspense as Boundary, lazy } from "react";

const Panel = lazy(() => import("./suspense-panel"));

export const LazyPanel = () => (
  <Suspense fallback={<p>Loading</p>}>
    <Panel />
  </Suspense>
);

export const AliasedLazyPanel = () => (
  <Boundary fallback={<p>Loading</p>}>
    <Panel />
  </Boundary>
);
