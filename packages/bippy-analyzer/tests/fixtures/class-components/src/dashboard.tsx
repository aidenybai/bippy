import { Component, PureComponent } from "react";
import { BasePanel, type PanelProps } from "./base";

interface CounterState {
  count: number;
  label: string;
}

class Counter extends Component<{ start: number }, CounterState> {
  static defaultProps = { start: 3 };

  state: CounterState = { count: this.props.start, label: "counter" };

  increment = () => this.setState((previous) => ({ count: previous.count + 1 }));

  render() {
    return (
      <div className={this.state.label}>
        {this.state.count > 0 ? <span>{this.state.count}</span> : <em>empty</em>}
        <button type="button" onClick={this.increment}>
          inc
        </button>
      </div>
    );
  }
}

class Badge extends PureComponent<{ text: string }> {
  render() {
    return <b>{this.props.text}</b>;
  }
}

class StatsPanel extends BasePanel<PanelProps & { rows: string[] }, { open: boolean }> {
  constructor(props: PanelProps & { rows: string[] }) {
    super(props);
    this.state = { open: true };
  }

  render() {
    const { rows } = this.props;
    return (
      <section>
        {this.renderHeader()}
        {this.state.open ? (
          <ul>
            {rows.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        ) : null}
        <Counter />
        <Badge text="new" />
      </section>
    );
  }
}

export class Dashboard extends Component<{ title: string }> {
  render() {
    return <StatsPanel title={this.props.title} rows={["cpu", "mem"]} />;
  }
}
