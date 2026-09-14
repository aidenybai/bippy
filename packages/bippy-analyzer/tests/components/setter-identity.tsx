import { useEffect, useReducer, useRef } from "react";

const defaultDispatch = () => undefined;
const increment = (count: number) => count + 1;

export default () => {
  const [count, dispatch] = useReducer(increment, 0);
  const initialDispatch = useRef(dispatch);
  useEffect(() => {
    if (dispatch === defaultDispatch) return;
    dispatch();
  }, [dispatch]);
  return (
    <main>
      {dispatch === defaultDispatch ? <aside>default</aside> : <strong>real dispatch</strong>}
      {initialDispatch.current === dispatch ? <span>stable</span> : <b>changed</b>}
      <output>count: {count}</output>
    </main>
  );
};

export const isExact = true;
