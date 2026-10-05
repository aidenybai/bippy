import { Component } from "react";

interface Snapshot {
  version: number;
  label: string;
  isOdd: boolean;
}

const listeners = new Set<() => void>();
let version = 0;

const publish = () => {
  version += 1;
  for (const listener of listeners) listener();
};

const takeSnapshot = (): Snapshot => ({
  version,
  label: `v${version}`,
  isOdd: version % 2 === 1,
});

/** Merges a whole snapshot on every publish the static side cannot rule out; the merges must stay per-key, not nest. */
class Subscriber extends Component<object, Snapshot> {
  state = takeSnapshot();

  componentDidMount() {
    listeners.add(this.handleChange);
  }

  componentWillUnmount() {
    listeners.delete(this.handleChange);
  }

  handleChange = () => {
    const next = takeSnapshot();
    if (Date.now() > 0 && next.version !== this.state.version) this.setState(next);
  };

  render() {
    return (
      <output>
        {this.state.label} {this.state.isOdd ? "odd" : "even"} {Object.keys(this.state).length}
      </output>
    );
  }
}

class Publisher extends Component {
  componentDidMount() {
    for (let step = 0; step < 24; step += 1) publish();
  }

  render() {
    return <Subscriber />;
  }
}

export const isPartial = true;

export default function ClassStateMerges() {
  return <Publisher />;
}
