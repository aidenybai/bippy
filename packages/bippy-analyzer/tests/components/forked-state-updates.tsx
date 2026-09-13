import { Component, useEffect, useState } from "react";

const isOffline = () => !navigator.onLine;

/** An update queued on one path of an undecided fork must leave the other path's state untouched. */
const OneSidedUpdate = () => {
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (isOffline()) setIsReady(true);
  }, []);
  return isReady ? <i>ready</i> : <u>waiting</u>;
};

const TwoSidedUpdate = () => {
  const [label, setLabel] = useState("none");
  useEffect(() => {
    if (isOffline()) {
      setLabel("offline");
    } else {
      setLabel("online");
    }
  }, []);
  return <b>{label}</b>;
};

class ClassUpdate extends Component<Record<string, never>, { count: number }> {
  state = { count: 0 };

  componentDidMount() {
    if (isOffline()) this.setState({ count: 1 });
  }

  render() {
    return this.state.count > 0 ? <strong>counted</strong> : <em>zero</em>;
  }
}

export default function ForkedStateUpdates() {
  return (
    <section>
      <OneSidedUpdate />
      <TwoSidedUpdate />
      <ClassUpdate />
    </section>
  );
}
