import { useEffect, useReducer, useState } from "react";
import { Boundary } from "./internal/reducer-error-boundary";

const ReducerPhase = () => {
  const [value, dispatch] = useReducer(() => {
    throw new Error("reducer failure");
  }, 0);
  const [caught, setCaught] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        dispatch();
      } catch {
        setCaught(true);
      }
    }, 5);
    return () => clearTimeout(handle);
  }, []);
  return (
    <main>
      <span>{value}</span>
      {caught ? "caught during dispatch" : "waiting"}
    </main>
  );
};

export default () => (
  <Boundary>
    <ReducerPhase />
  </Boundary>
);
