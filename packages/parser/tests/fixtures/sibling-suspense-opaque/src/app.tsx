import { Suspense } from "react";
import { Card } from "ui-kit";

const Panel = ({ title }: { title: string }) => (
  <Suspense fallback={<p>loading {title}</p>}>
    <Card title={title}>
      <p>inside {title}</p>
    </Card>
  </Suspense>
);

export const App = () => (
  <main>
    <h3>before</h3>
    <Suspense fallback={<p>loading page</p>}>
      <Card title="page">
        <Panel title="first" />
        <Panel title="second" />
      </Card>
    </Suspense>
    <h3>after</h3>
  </main>
);
