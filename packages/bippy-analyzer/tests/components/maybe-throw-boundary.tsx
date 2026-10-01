import { Component, type ReactNode, useEffect, useState } from "react";

// A child that may throw (the analysis cannot see the URL hash) makes the
// boundary retry its subtree ignoring the possible throw; that retry must
// re-evaluate the child instead of reusing the render that threw.

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

const Label = () => {
  const label = window.location.hash.slice(1);
  if (label.startsWith("!")) throw new Error(`bad label: ${label}`);
  return <em>{label || "default"}</em>;
};

const Loader = ({ children }: { children: ReactNode }) => {
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    setIsLoading(false);
  }, []);
  return isLoading ? <p>loading</p> : children;
};

export default function MaybeThrowBoundary() {
  return (
    <Boundary>
      <Loader>
        <section>
          <Label />
        </section>
      </Loader>
    </Boundary>
  );
}
