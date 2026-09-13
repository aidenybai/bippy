import { Component, PureComponent, type ReactNode } from "react";

interface CounterProps {
  start: number;
}

interface CounterState {
  count: number;
}

class Counter extends Component<CounterProps, CounterState> {
  state: CounterState = { count: this.props.start };

  increment = () => this.setState({ count: this.state.count + 1 });

  render() {
    return (
      <div>
        <output>{this.state.count}</output>
        <button type="button" onClick={this.increment}>
          +
        </button>
        {this.props.start > 0 ? <em>positive</em> : <em>zero</em>}
      </div>
    );
  }
}

class Legacy extends PureComponent<{ title: string }> {
  constructor(props: { title: string }) {
    super(props);
    this.state = { isOpen: true };
  }

  renderTitle() {
    return <h4>{this.props.title}</h4>;
  }

  render() {
    return (
      <section>
        {this.renderTitle()}
        <p>legacy</p>
      </section>
    );
  }
}

interface BoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) return <pre>{this.state.error.message}</pre>;
    return this.props.children;
  }
}

export default function ClassComponents() {
  return (
    <ErrorBoundary>
      <Counter start={1} />
      <Legacy title="Legacy" />
    </ErrorBoundary>
  );
}
