import { StrictMode, useEffect, useReducer, useRef } from "react";

const ReducerPhase = () => {
  const calls = useRef(0);
  const [total, dispatch] = useReducer(() => ++calls.current, 0);
  useEffect(() => {
    const handle = setTimeout(() => dispatch(), 5);
    return () => clearTimeout(handle);
  }, []);
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
