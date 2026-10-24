import { useReducer, useState } from "react";

type Mode = "a" | "b";

const count = (state: { count: number }, step: number) => ({ count: state.count + step });

export const LazyObject = () => {
  const [box] = useState(() => ({ clicks: 0 }));
  return box.clicks === 0 ? <i>yes</i> : <i>no</i>;
};

export const LazyFlag = () => {
  const [mode] = useState<Mode>("a");
  const [isB] = useState(() => mode === "b");
  return isB ? <i>yes</i> : <i>no</i>;
};

export const InitReducer = () => {
  const [state] = useReducer(count, 1, (initial) => ({ count: initial }));
  return state.count === 1 ? <i>yes</i> : <i>no</i>;
};
