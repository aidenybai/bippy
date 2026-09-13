import * as Sentry from "@sentry/react";

Sentry.init({ dsn: "" });

export const App = () => (
  <Sentry.ErrorBoundary fallback={<p>something went wrong</p>}>
    <main>
      <h1>whiteboard</h1>
    </main>
  </Sentry.ErrorBoundary>
);
