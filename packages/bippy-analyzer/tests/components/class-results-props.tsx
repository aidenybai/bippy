import { Component } from "react";

class Derived extends Component {
  state = { label: "initial" };
  static getDerivedStateFromProps() {
    return { label: this === undefined ? "unbound" : "bound" };
  }
  render() {
    return (
      <main>
        <span>Result:</span>
        {this.state.label}
      </main>
    );
  }
}
export default () => <Derived />;
