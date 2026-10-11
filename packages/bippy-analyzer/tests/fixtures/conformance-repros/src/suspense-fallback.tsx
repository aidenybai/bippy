import { Suspense, lazy } from "react";

/**
 * A `Suspense` boundary shows its fallback until its children stop suspending, as
 * vercel/commerce's `Collections` does around an async server component.
 */

const Panel = lazy(() => import("./suspense-panel"));

// commerce components/layout/search/collections.tsx:17
export const LazyPanel = () => (
  <Suspense fallback={<p>Loading</p>}>
    <Panel />
  </Suspense>
);
