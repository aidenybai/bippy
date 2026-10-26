import { useReducer, useState } from "react";

export const FieldCounter = () => {
  const [state, setState] = useState({ count: 0 });
  return (
    <div>
      <button onClick={() => setState({ count: state.count + 1 })}>add</button>
      <button onClick={() => setState({ count: 0 })}>reset</button>
      {state.count === 0 ? <i>none</i> : state.count === 1 ? <i>one</i> : <i>many</i>}
    </div>
  );
};

export const SpreadFieldCounter = () => {
  const [state, setState] = useState({ count: 0, isOpen: false });
  return (
    <div>
      <button onClick={() => setState((previous) => ({ ...previous, count: previous.count + 1 }))}>
        add
      </button>
      <button onClick={() => setState((previous) => ({ ...previous, isOpen: !previous.isOpen }))}>
        toggle
      </button>
      {state.count === 0 ? <i>none</i> : state.count === 1 ? <i>one</i> : <i>many</i>}
    </div>
  );
};

const countReducer = (state: { count: number; label: string }, action: "add" | "clear") =>
  action === "add" ? { ...state, count: state.count + 1 } : { ...state, count: 0 };

export const ReducerFieldCounter = () => {
  const [state, dispatch] = useReducer(countReducer, { count: 0, label: "items" });
  return (
    <div>
      <button onClick={() => dispatch("add")}>add</button>
      <button onClick={() => dispatch("clear")}>clear</button>
      {state.count === 0 ? <i>none</i> : state.count === 1 ? <i>one</i> : <i>many</i>}
    </div>
  );
};

export const StaleFieldWrites = () => {
  const [state, setState] = useState({ count: 0, isOpen: false });
  return (
    <div>
      <button
        onClick={() => {
          setState({ ...state, count: state.count + 1 });
          setState({ ...state, isOpen: true });
        }}
      >
        both
      </button>
      {state.count === 0 ? <i>none</i> : <i>some</i>}
      {state.isOpen ? <b>open</b> : <b>shut</b>}
    </div>
  );
};

export const DoubleFieldUpdater = () => {
  const [state, setState] = useState({ count: 0 });
  return (
    <div>
      <button
        onClick={() => {
          setState((previous) => ({ count: previous.count + 1 }));
          setState((previous) => ({ count: previous.count + 1 }));
        }}
      >
        twice
      </button>
      {state.count === 0 ? <i>none</i> : state.count === 1 ? <i>one</i> : <i>many</i>}
    </div>
  );
};
