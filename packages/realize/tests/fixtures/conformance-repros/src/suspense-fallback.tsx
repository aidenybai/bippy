import { Suspense, Suspense as Boundary, lazy, use, useState } from "react";

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

const pages = new Map<number, Promise<string>>();
const loadPage = (page: number) => {
  if (!pages.has(page)) pages.set(page, Promise.resolve(`page ${page}`));
  return pages.get(page)!;
};

const Page = ({ page }: { page: number }) => <p>{use(loadPage(page))}</p>;

export const PagedPanel = () => {
  const [page, setPage] = useState(1);
  return (
    <div>
      <Suspense fallback={<p>Loading</p>}>
        <Page page={page} />
      </Suspense>
      <button onClick={() => setPage(page + 1)}>next</button>
    </div>
  );
};
