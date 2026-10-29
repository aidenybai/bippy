import { createContext, useCallback, useContext, useRef, useState } from "react";

const RefSteps = createContext(() => {});
const CallbackSteps = createContext(() => {});
const StateSteps = createContext(() => {});
const LatestSteps = createContext(() => {});

const RefStep = () => {
  const onStep = useContext(RefSteps);
  const first = useRef(onStep);
  return <button onClick={() => first.current()}>step</button>;
};

const CallbackStep = () => {
  const onStep = useContext(CallbackSteps);
  const run = useCallback(() => onStep(), []);
  return <button onClick={run}>step</button>;
};

const StateStep = () => {
  const onStep = useContext(StateSteps);
  const [first] = useState(() => onStep);
  return <button onClick={first}>step</button>;
};

const LatestStep = () => {
  const onStep = useContext(LatestSteps);
  return <button onClick={onStep}>step</button>;
};

export const HeldRefContext = () => {
  const [n, setN] = useState(0);
  return (
    <RefSteps.Provider value={() => setN(n + 1)}>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <RefStep />
      <button onClick={() => setN(n + 2)}>two</button>
    </RefSteps.Provider>
  );
};

export const HeldCallbackContext = () => {
  const [n, setN] = useState(0);
  return (
    <CallbackSteps.Provider value={() => setN(n + 1)}>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <CallbackStep />
      <button onClick={() => setN(n + 2)}>two</button>
    </CallbackSteps.Provider>
  );
};

export const HeldStateContext = () => {
  const [n, setN] = useState(0);
  return (
    <StateSteps.Provider value={() => setN(n + 1)}>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <StateStep />
      <button onClick={() => setN(n + 2)}>two</button>
    </StateSteps.Provider>
  );
};

export const LatestContext = () => {
  const [n, setN] = useState(0);
  return (
    <LatestSteps.Provider value={() => setN(n + 1)}>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <LatestStep />
      <button onClick={() => setN(n + 2)}>two</button>
    </LatestSteps.Provider>
  );
};
