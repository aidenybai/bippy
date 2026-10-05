import { Component, createContext } from "react";

const trace: string[] = [];
const Context = createContext("context");
interface CounterProps {
  label: string;
}
interface CounterState {
  count: number;
  label: string;
}
class Counter extends Component<CounterProps, CounterState> {
  static contextType = Context;
  #secret = "private";
  state = { count: 0, label: "" };
  constructor(props: CounterProps) {
    super(props);
    trace.push(`construct:${props.label}`);
  }
  static getDerivedStateFromProps(props: CounterProps, state: CounterState) {
    trace.push(`derive:${state.count}`);
    return { label: props.label };
  }
  componentDidMount() {
    trace.push(`mount:${this.context}:${this.#secret}`);
    this.setState(
      (state) => ({ count: state.count + 1 }),
      () => trace.push(`callback:${this.state.count}`),
    );
  }
  shouldComponentUpdate(_props: CounterProps, state: CounterState) {
    trace.push(`should:${state.count}`);
    return state.count !== this.state.count;
  }
  getSnapshotBeforeUpdate(_props: CounterProps, state: CounterState) {
    trace.push(`snapshot:${state.count}`);
    return `from:${state.count}`;
  }
  componentDidUpdate(_props: CounterProps, _state: CounterState, snapshot: string) {
    trace.push(`update:${snapshot}:${this.state.count}`);
  }
  componentWillUnmount() {
    trace.push(`unmount:${this.#secret}:${this.state.count}`);
  }
  render() {
    trace.push(`render:${this.state.count}`);
    return (
      <button onClick={() => this.setState((state) => ({ count: state.count + 1 }))}>
        {this.state.label}:{this.state.count}:{this.#secret}
      </button>
    );
  }
}
export default () => (
  <Context.Provider value="provided">
    <Counter label="counter" />
  </Context.Provider>
);
export const getTrace = () => trace;
