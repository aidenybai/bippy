import { Component } from "react";

class Mounted extends Component {
  state = { label: "mount" };
  componentDidMount() {
    this.setState({ label: "ready" });
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

export default () => <Mounted />;
