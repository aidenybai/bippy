import type * as React from "react";
import { ErrorBoundary } from "react-error-boundary";

export interface LibrarySection {
  name: string;
  Component: React.ComponentType<object>;
}

// Every library section renders inside its own error boundary so the spec
// can name exactly which library broke instead of losing the whole page.
export const SectionFrame = ({ name, Component }: LibrarySection) => (
  <ErrorBoundary
    fallbackRender={({ error }) => (
      <div data-testid="section-error" data-section={name}>
        {String(error)}
      </div>
    )}
  >
    <section data-testid={`lib-${name}`}>
      <h2>{name}</h2>
      <Component />
    </section>
  </ErrorBoundary>
);
