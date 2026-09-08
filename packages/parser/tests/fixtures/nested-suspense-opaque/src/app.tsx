import { Suspense } from "react";
import { Card, Stack } from "ui-kit";

const Skeleton = () => (
  <Stack gap={1}>
    <p>loading</p>
  </Stack>
);

const Search = () => (
  <Card title="search">
    <input placeholder="query" />
  </Card>
);

export const App = () => (
  <Suspense fallback={null}>
    <div>
      <Suspense fallback={<Skeleton />}>
        <Search />
      </Suspense>
    </div>
  </Suspense>
);
