import { createContext, useContext, useEffect, useReducer } from "react";

interface State {
  count: number;
}
const Context = createContext<State>({ count: -1 });
const trace: string[] = [];
export const getTrace = () => trace.slice();
const Reader = () => {
  const value = useContext(Context);
  return (
    <Context.Consumer>
      {(other) => (
        <output>
          {value.count}:{String(value === other)}
        </output>
      )}
    </Context.Consumer>
  );
};
const ContextReducer = () => {
  const [state, dispatch] = useReducer(
    (previous: State, amount: number) => ({ count: previous.count + amount }),
    2,
    (count) => {
      trace.push(`init:${count}`);
      return { count };
    },
  );
  useEffect(() => {
    dispatch(3);
  }, []);
  return (
    <Context.Provider value={state}>
      <Reader />
    </Context.Provider>
  );
};
export default ContextReducer;
