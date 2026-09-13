import { Suspense } from "react";
import { Card, Stack } from "ui-kit";

export const App = () => (
  <Suspense fallback={<progress />}>
    <Stack gap={1}>
      <Card title="outer">
        <p>outer body</p>
      </Card>
      <section>
        <Suspense fallback={<span>inner…</span>}>
          <Card title="inner">
            <p>inner body</p>
          </Card>
        </Suspense>
      </section>
    </Stack>
  </Suspense>
);
