import { Component } from "react";
import { Boundary } from "./internal/reducer-error-boundary.js";

class Uncertain extends Component {
  constructor(props: Record<string, never>) {
    super(props);
    if (Math.random() > 0.5) throw new Error("constructor");
  }
  render = () => (
    <main>
      <span>Result:</span>
      {"ready"}
    </main>
  );
}

export default () => (
  <Boundary>
    <Uncertain />
  </Boundary>
);
