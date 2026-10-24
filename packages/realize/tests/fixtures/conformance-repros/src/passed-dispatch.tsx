import { createContext, useContext, useReducer } from "react";

const toggle = (state: boolean, action: string) => (action === "on" ? true : state);

const Child = ({ send }: { send: (action: string) => void }) => (
  <button onClick={() => send("on")}>on</button>
);

export const DispatchProp = () => {
  const [isOn, dispatch] = useReducer(toggle, false);
  return (
    <div>
      <Child send={dispatch} />
      {isOn ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

const SendContext = createContext<(action: string) => void>(() => {});

const ContextButton = () => {
  const send = useContext(SendContext);
  return <button onClick={() => send("on")}>on</button>;
};

export const DispatchContext = () => {
  const [isOn, dispatch] = useReducer(toggle, false);
  return (
    <SendContext.Provider value={dispatch}>
      <ContextButton />
      {isOn ? <i>yes</i> : <i>no</i>}
    </SendContext.Provider>
  );
};
