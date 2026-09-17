import { Component, StrictMode, useEffect, useLayoutEffect, useState } from "react";

/** Every effect and cleanup appends here, so the rendered log exposes Strict Mode's replay and unmount order. */
const log: string[] = [];

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

const List = () => {
  const [showsSecond, setShowsSecond] = useState(true);
  useEffect(() => {
    setShowsSecond(false);
  }, []);
  return (
    <ul>
      <Subscriber name="first" />
      {showsSecond && <Subscriber name="second" />}
      <Legacy name="legacy" />
      {showsSecond && <Legacy name="legacy-second" />}
    </ul>
  );
};

export default () => (
  <StrictMode>
    <List />
    <Reporter />
  </StrictMode>
);
