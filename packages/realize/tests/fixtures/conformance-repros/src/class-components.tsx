import { Component, PureComponent, useState } from "react";
import * as React from "react";

export class ClassCounter extends Component<{ start: number }, { count: number }> {
  state = { count: this.props.start };

  render() {
    return (
      <button onClick={() => this.setState({ count: this.state.count + 1 })}>
        {this.state.count}
      </button>
    );
  }
}

export const ClassBadge = class extends PureComponent<{ label: string }> {
  render() {
    return <span>{this.props.label}</span>;
  }
};

export class ClassPanel extends React.Component {
  render() {
    return <section />;
  }
}

export class PlainHelper {
  render() {
    return null;
  }
}

export class ClassSwitch extends Component<object, { isOn: boolean }> {
  state = { isOn: false };

  flip = () => this.setState({ isOn: !this.state.isOn });

  render() {
    return <button onClick={this.flip}>{this.state.isOn ? "on" : "off"}</button>;
  }
}

export class ClassStepper extends Component<object, { step: number }> {
  constructor(props: object) {
    super(props);
    this.state = { step: 0 };
    this.advance = this.advance.bind(this);
  }

  advance() {
    this.setState((previous) => ({ step: (previous.step + 1) % 3 }));
    this.setState((previous) => ({ step: (previous.step + 1) % 3 }));
  }

  render() {
    return <button onClick={this.advance}>{this.state.step === 0 ? "start" : "moved"}</button>;
  }
}

export const FunctionStepper = () => {
  const [state, setState] = useState({ step: 0 });
  const advance = () => {
    setState((previous) => ({ ...previous, step: (previous.step + 1) % 3 }));
    setState((previous) => ({ ...previous, step: (previous.step + 1) % 3 }));
  };
  return <button onClick={advance}>{state.step === 0 ? "start" : "moved"}</button>;
};

export class ClassReady extends Component<object, { isReady: boolean }> {
  state = { isReady: false };

  componentDidMount() {
    this.setState({ isReady: true });
  }

  render() {
    return <p>{this.state.isReady ? "ready" : "loading"}</p>;
  }
}

export class ClassAfterUpdate extends Component<object, { count: number }> {
  state = { count: 0 };

  componentDidUpdate() {
    if (this.state.count > 3) this.setState({ count: 0 });
  }

  render() {
    return (
      <button onClick={() => this.setState({ count: this.state.count + 1 })}>
        {this.state.count}
      </button>
    );
  }
}

export class ClassForced extends Component {
  render() {
    return <button onClick={() => this.forceUpdate()}>refresh</button>;
  }
}

export class ClassDelayed extends Component<object, { count: number }> {
  state = { count: 0 };

  later = () => {
    setTimeout(() => this.setState({ count: this.state.count + 1 }), 100);
  };

  render() {
    return <button onClick={this.later}>{this.state.count > 0 ? "late" : "early"}</button>;
  }
}
