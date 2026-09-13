import { useEffect, useReducer } from "react";

interface Action {
  amount: number;
}

export default () => {
  const [total, dispatch] = useReducer(
    (previous: number, action: Action) => previous + action.amount,
    0,
  );
  useEffect(() => {
    const action = { amount: 1 };
    const handle = setTimeout(() => {
      dispatch(action);
      action.amount = 2;
      dispatch(action);
      action.amount = 5;
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
