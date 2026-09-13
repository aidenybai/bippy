import { Component } from "react";
import type { ReactNode } from "react";

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
  error: unknown;
}

const shouldUseFirst = Math.random() < 0.5;
const firstFailure = { kind: "first" };
const secondFailure = { kind: "second" };

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, error: undefined };

  static getDerivedStateFromError = (error: unknown): BoundaryState => ({
    hasError: true,
    error,
  });

  render = (): ReactNode => {
    if (!this.state.hasError) return this.props.children;
    const expected = shouldUseFirst ? firstFailure : secondFailure;
    return this.state.error === expected ? <main /> : <aside />;
  };
}

const Thrower = (): never => {
  if (shouldUseFirst) throw firstFailure;
  throw secondFailure;
};

export default () => (
  <Boundary>
    <Thrower />
  </Boundary>
);
export const isExact = true;
