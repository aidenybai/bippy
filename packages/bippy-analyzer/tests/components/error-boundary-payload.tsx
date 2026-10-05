import { Component } from "react";
import type { ReactNode } from "react";

interface BoundaryProps {
  expected: unknown;
  label: string;
  children: ReactNode;
  shouldRethrow?: boolean;
}

interface BoundaryState {
  hasError: boolean;
  error: unknown;
}

interface ThrowerProps {
  value: unknown;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, error: undefined };

  static getDerivedStateFromError = (error: unknown): BoundaryState => ({
    hasError: true,
    error,
  });

  render = (): ReactNode => {
    if (!this.state.hasError) return this.props.children;
    if (this.props.shouldRethrow) throw this.state.error;
    return this.state.error === this.props.expected ? (
      <output>
        {this.props.label}
        {" caught"}
      </output>
    ) : (
      <aside>
        {this.props.label}
        {" replaced"}
      </aside>
    );
  };
}

const Thrower = ({ value }: ThrowerProps): never => {
  throw value;
};

const payload = { kind: "missing", resource: "profile" };
const failure = new Error("unavailable");

export default () => (
  <main>
    <Boundary expected={payload} label="object">
      <Thrower value={payload} />
    </Boundary>
    <Boundary expected={failure} label="error">
      <Thrower value={failure} />
    </Boundary>
    <Boundary expected="missing" label="string">
      <Thrower value="missing" />
    </Boundary>
    <Boundary expected={undefined} label="undefined">
      <Thrower value={undefined} />
    </Boundary>
    <Boundary expected={null} label="null">
      <Thrower value={null} />
    </Boundary>
    <Boundary expected={payload} label="rethrown">
      <Boundary expected={payload} label="inner" shouldRethrow>
        <Thrower value={payload} />
      </Boundary>
    </Boundary>
  </main>
);

export const isExact = true;
