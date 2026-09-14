import { Component, type ReactNode, useEffect, useState } from "react";

interface BoundaryProps {
  name: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) return <pre>{`${this.props.name}: ${this.state.error.message}`}</pre>;
    return this.props.children;
  }
}

const MaybeBroken = ({ label }: { label: string }) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  if (Date.now() < 0) throw new Error("time ran backwards");
  return (
    <em>
      {label}
      {isMounted ? <b>mounted</b> : null}
    </em>
  );
};

export default function NestedErrorBoundaries() {
  return (
    <Boundary name="outer">
      <section>
        <Boundary name="inner">
          <MaybeBroken label="guarded twice" />
        </Boundary>
        <MaybeBroken label="guarded once" />
      </section>
    </Boundary>
  );
}
