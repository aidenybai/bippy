import { Component } from "react";
import { Boundary } from "./internal/reducer-error-boundary.js";

class Broken extends Component {
  constructor(props: Record<string, never>) {
    super(props);
    throw new Error("constructor");
  }
  render = () => (
    <main>
      <span>Result:</span>
      {"wrong"}
    </main>
  );
}

export default () => (
  <Boundary>
    <Broken />
  </Boundary>
);
