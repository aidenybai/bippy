import { StrictMode, useReducer, useRef } from "react";

const ReducerPhase = () => {
  const calls = useRef(0);
  const [total, dispatch] = useReducer(() => ++calls.current, 0);
  if (total === 0) dispatch();
  return (
    <main>
      <span>Calls:</span>
      {total}
    </main>
  );
};

export default () => (
  <StrictMode>
    <ReducerPhase />
  </StrictMode>
);
