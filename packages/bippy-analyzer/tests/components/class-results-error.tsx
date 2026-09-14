import { Component, type ReactNode } from "react";

interface BoundaryProps {
  children: ReactNode;
}
class Boundary extends Component<BoundaryProps> {
  state = { label: "" };
  static getDerivedStateFromError() {
    return { label: this === undefined ? "unbound" : "bound" };
  }
  render() {
    return this.state.label ? (
      <main>
        <span>Result:</span>
        {this.state.label}
      </main>
    ) : (
      this.props.children
    );
  }
}
const Broken = () => {
  throw new Error("broken");
};
export default () => (
  <Boundary>
    <Broken />
  </Boundary>
);
