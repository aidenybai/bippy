import { Component, type ReactNode } from "react";

// The analysis cannot see the URL hash, so `crashingError` is a branch: on one
// path `<Crash>` always throws. That throw belongs to that path only; the
// boundary may catch it, and the other path renders the document.

interface BoundaryState {
  error: Error | null;
}

class Boundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) return <pre>{this.state.error.message}</pre>;
    return this.props.children;
  }
}

const Crash = ({ crashingError }: { crashingError: Error }): null => {
  throw crashingError;
};

const Document = ({ title }: { title: string }) => (
  <article>
    <h1>{title}</h1>
    <p>ready</p>
  </article>
);

const getCrashingError = (): Error | null => {
  const hash = window.location.hash.slice(1);
  return hash.startsWith("crash:") ? new Error(hash.slice("crash:".length)) : null;
};

export const isPartial = true;

export default function ThrowingAlternative() {
  const crashingError = getCrashingError();
  return (
    <Boundary>
      <main>
        {crashingError ? <Crash crashingError={crashingError} /> : <Document title="untitled" />}
      </main>
    </Boundary>
  );
}
