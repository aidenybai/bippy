import { useEffect, useReducer } from "react";
import { Boundary } from "./internal/reducer-error-boundary";

const ReducerPhase = () => {
  const [value, dispatch] = useReducer((previous: number, shouldThrow: boolean) => {
    if (shouldThrow) throw new Error("guarded reducer failure");
    return previous + 1;
  }, 0);
  useEffect(() => {
    const handle = setTimeout(() => dispatch(Math.random() > 0.5), 5);
    return () => clearTimeout(handle);
  }, []);
  return (
    <main>
      <span>Value:</span>
      {value}
    </main>
  );
};

export default () => (
  <Boundary>
    <ReducerPhase />
  </Boundary>
);
