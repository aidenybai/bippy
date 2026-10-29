import { useReducer, useState } from "react";
import { DEFAULTS, addBy, increment, init } from "./imported-updaters-shared";

const reducer = (count: number, by: number) => count + by;

const localIncrement = (count: number) => count + 1;

const LOCAL_DEFAULTS = { count: 0 };

const localInit = (start: number) => start + 1;

export const ImportedUpdater = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      {count === 0 ? <i>before</i> : count === 1 ? <i>middle</i> : <i>after</i>}
      <button onClick={() => setCount(increment)}>a</button>
      <button onClick={() => setCount(0)}>b</button>
    </div>
  );
};

export const ImportedDefaults = () => {
  const [state, setState] = useState(DEFAULTS);
  return (
    <div>
      {state.count === 0 ? <i>before</i> : state.count === 1 ? <i>middle</i> : <i>after</i>}
      <button onClick={() => setState({ count: state.count + 1 })}>a</button>
      <button onClick={() => setState(DEFAULTS)}>b</button>
    </div>
  );
};

export const ImportedInit = () => {
  const [count, add] = useReducer(reducer, -1, init);
  return (
    <div>
      {count === 0 ? <i>before</i> : count === 1 ? <i>middle</i> : <i>after</i>}
      <button onClick={() => add(1)}>a</button>
    </div>
  );
};

export const ImportedReducer = () => {
  const [count, add] = useReducer(addBy, 0);
  return (
    <div>
      {count === 0 ? <i>before</i> : count === 1 ? <i>middle</i> : <i>after</i>}
      <button onClick={() => add(1)}>a</button>
    </div>
  );
};

export const LocalReducer = () => {
  const [count, add] = useReducer(reducer, 0);
  return (
    <div>
      {count === 0 ? <i>before</i> : count === 1 ? <i>middle</i> : <i>after</i>}
      <button onClick={() => add(1)}>a</button>
    </div>
  );
};

export const LocalUpdater = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      {count === 0 ? <i>before</i> : count === 1 ? <i>middle</i> : <i>after</i>}
      <button onClick={() => setCount(localIncrement)}>a</button>
      <button onClick={() => setCount(0)}>b</button>
    </div>
  );
};

export const LocalDefaults = () => {
  const [state, setState] = useState(LOCAL_DEFAULTS);
  return (
    <div>
      {state.count === 0 ? <i>before</i> : state.count === 1 ? <i>middle</i> : <i>after</i>}
      <button onClick={() => setState({ count: state.count + 1 })}>a</button>
      <button onClick={() => setState(LOCAL_DEFAULTS)}>b</button>
    </div>
  );
};

export const LocalInit = () => {
  const [count, add] = useReducer(reducer, -1, localInit);
  return (
    <div>
      {count === 0 ? <i>before</i> : count === 1 ? <i>middle</i> : <i>after</i>}
      <button onClick={() => add(1)}>a</button>
    </div>
  );
};
