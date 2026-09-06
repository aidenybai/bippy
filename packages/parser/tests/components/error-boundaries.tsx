import { Component, type ErrorInfo, type ReactNode } from "react";

interface BoundaryProps {
  fallback: (error: Error) => ReactNode;
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

  componentDidCatch(_error: Error, _info: ErrorInfo): void {}

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

const Broken = ({ message }: { message: string }): ReactNode => {
  throw new Error(message);
};

const Fine = () => <p>fine</p>;

const shouldExplode = (input: string): boolean => input.length > 3;

const MaybeBroken = ({ input }: { input: string }) => {
  if (shouldExplode(input)) throw new Error(`too long: ${input}`);
  return <em>{input}</em>;
};

export default function ErrorBoundaries() {
  return (
    <div>
      <Boundary fallback={(error) => <pre>{error.message}</pre>}>
        <Fine />
      </Boundary>
      <Boundary fallback={(error) => <pre>{error.message}</pre>}>
        <Broken message="boom" />
      </Boundary>
      <Boundary fallback={() => <i>recovered</i>}>
        <section>
          <Fine />
          <MaybeBroken input="ok" />
          <MaybeBroken input="too long" />
        </section>
      </Boundary>
    </div>
  );
}
