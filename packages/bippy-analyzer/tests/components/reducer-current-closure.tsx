import { useEffect, useReducer, useState } from "react";

export default () => {
  const [factor, setFactor] = useState(1);
  const [total, dispatch] = useReducer(
    (previous: number, amount: number) => previous + amount * factor,
    0,
  );
  useEffect(() => {
    const handle = setTimeout(() => {
      setFactor(3);
      dispatch(2);
      dispatch(1);
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
