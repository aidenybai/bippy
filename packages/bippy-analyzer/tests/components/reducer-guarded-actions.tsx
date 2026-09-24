import { useEffect, useReducer, useRef } from "react";

export default () => {
  const multiplier = useRef(1);
  const [total, dispatch] = useReducer(
    (previous: number, amount: number) => previous + amount * multiplier.current,
    0,
  );
  useEffect(() => {
    const handle = setTimeout(() => {
      if (Math.random() > 0.5) {
        dispatch(1);
        multiplier.current = 10;
      } else {
        dispatch(2);
        multiplier.current = 100;
      }
      dispatch(3);
    }, 5);
    return () => clearTimeout(handle);
  }, []);
  return (
    <main>
      <span>Total:</span>
      {total}
    </main>
  );
};
