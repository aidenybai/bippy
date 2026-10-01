import { Component, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

const log: string[] = [];

const listeners = new Set<() => void>();
let subscriptions = 0;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  subscriptions++;
  log.push(`subscribe:${subscriptions}`);
  return () => {
    listeners.delete(listener);
    subscriptions--;
    log.push(`unsubscribe:${subscriptions}`);
  };
};

const getSnapshot = () => subscriptions;

const Subscriber = ({ name }: { name: string }) => {
  useLayoutEffect(() => {
    log.push(`${name}:layout`);
    return () => {
      log.push(`${name}:layout-cleanup`);
    };
  }, [name]);
  useEffect(() => {
    log.push(`${name}:passive`);
    return () => {
      log.push(`${name}:passive-cleanup`);
    };
  });
  useEffect(() => {
    log.push(`${name}:no-cleanup`);
  }, []);
  return <li>{name}</li>;
};

class Legacy extends Component<{ name: string }> {
  componentDidMount() {
    log.push(`${this.props.name}:didMount`);
  }
  componentDidUpdate() {
    log.push(`${this.props.name}:didUpdate`);
  }
  componentWillUnmount() {
    log.push(`${this.props.name}:willUnmount`);
  }
  render() {
    return <li>{this.props.name}</li>;
  }
}

const StoreReader = () => {
  const count = useSyncExternalStore(subscribe, getSnapshot);
  return <em>{count}</em>;
};

const Reporter = () => {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(log.join(" "));
  });
  return (
    <output>
      {text}
      <hr />
    </output>
  );
};

export const App = () => {
  const [showsSecond, setShowsSecond] = useState(true);
  useEffect(() => {
    setShowsSecond(false);
  }, []);
  return (
    <main>
      <ul>
        <Subscriber name="first" />
        {showsSecond && <Subscriber name="second" />}
        <Legacy name="legacy" />
        {showsSecond && <Legacy name="legacy-second" />}
      </ul>
      <StoreReader />
      <Reporter />
    </main>
  );
};
