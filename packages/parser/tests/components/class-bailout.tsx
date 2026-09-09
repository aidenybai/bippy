import * as React from "react";

/** Two text children become two HostText fibers, so the comparer checks the computed value. */
const Shown = ({ value }: { value: string }) => (
  <code>
    {"= "}
    {value}
  </code>
);

interface FrozenProps {
  count: number;
  onUpdate: () => void;
}

/** Declines every update: keeps the mounted output and skips `componentDidUpdate`. */
class Frozen extends React.Component<FrozenProps> {
  shouldComponentUpdate(): boolean {
    return false;
  }

  componentDidUpdate(): void {
    this.props.onUpdate();
  }

  render(): React.ReactNode {
    return this.props.count === 0 ? <b>initial</b> : <i>updated {this.props.count}</i>;
  }
}

interface ThresholdProps {
  count: number;
}

/** Re-renders only once the count crosses a threshold, reading the props React committed anyway. */
class Threshold extends React.Component<ThresholdProps> {
  shouldComponentUpdate(nextProps: ThresholdProps): boolean {
    return nextProps.count > 1;
  }

  render(): React.ReactNode {
    return <Shown value={`seen ${this.props.count}`} />;
  }
}

const Parent = () => {
  const [count, setCount] = React.useState(0);
  const [updates, setUpdates] = React.useState(0);
  React.useEffect(() => {
    if (count < 2) setCount(count + 1);
  }, [count]);
  return (
    <section>
      <Frozen count={count} onUpdate={() => setUpdates(updates + 1)} />
      <Threshold count={count} />
      <Shown value={`${count} renders, ${updates} child updates`} />
    </section>
  );
};

const arity = (callable: { length: number }): number => callable.length;

class Point {
  constructor(
    public x: number,
    public y: number,
    public label = "origin",
  ) {}
}

class Marker {}

const Arities = () => {
  const lengths = [
    arity((left: number, right: number) => left + right),
    arity((value: number, scale = 1) => value * scale),
    arity(function spread(...rest: number[]) {
      return rest.length;
    }),
    arity(Point),
    arity(Marker),
    arity(Math.max),
  ];
  return <Shown value={lengths.join(",")} />;
};

export default function ClassBailout() {
  return (
    <main>
      <Parent />
      <Arities />
    </main>
  );
}
