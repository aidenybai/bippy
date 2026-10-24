import { Component, PureComponent } from "react";
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
