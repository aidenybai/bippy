import { Component } from "react";

class Derived extends Component {
  state = { label: "initial" };
  static label = "class";
  static derive() {
    return { label: this.label };
  }
  static getDerivedStateFromProps = this.derive.bind({ label: "bound" });
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
