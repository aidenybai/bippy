import { Component } from "react";

export default class extends Component<{ start: number }> {
  render() {
    return <output>{this.props.start}</output>;
  }
}
