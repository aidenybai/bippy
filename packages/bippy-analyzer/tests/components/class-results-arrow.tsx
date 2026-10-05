import { Component } from "react";

class Derived extends Component {
  state = { label: "initial" };
  static label = "lexical";
  static getDerivedStateFromProps = () => ({ label: this.label });
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
