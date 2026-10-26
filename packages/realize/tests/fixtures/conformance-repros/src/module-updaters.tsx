import { useReducer, useState } from "react";

const increment = (count: number) => count + 1;

const getInitialCount = () => 1;

const startAbove = (start: number) => start + 1;

const reduceCount = (count: number, amount: number) => count + amount;

export const NamedUpdater = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(increment)}>{count === 0 ? "zero" : "more"}</button>;
};

export const NamedInitializer = () => {
  const [count, setCount] = useState(getInitialCount);
  return <button onClick={() => setCount(2)}>{count === 1 ? "one" : "other"}</button>;
};

export const NamedReducerInit = () => {
  const [count, dispatch] = useReducer(reduceCount, -1, startAbove);
  return <button onClick={() => dispatch(1)}>{count === 0 ? "zero" : "more"}</button>;
};
