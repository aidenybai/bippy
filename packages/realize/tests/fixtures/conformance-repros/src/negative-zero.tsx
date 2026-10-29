import { useState } from "react";

export const NegatedZero = () => {
  const [n, setN] = useState(0);
  return (
    <div>
      {1 / n > 0 ? <i>positive</i> : <i>negative</i>}
      <button onClick={() => setN(-n)}>negate</button>
    </div>
  );
};

export const NegatedAmount = () => {
  const [amount, setAmount] = useState(1);
  return (
    <div>
      {amount === 0 ? <i>zero</i> : <i>nonzero</i>}
      {1 / amount < 0 ? <i>negative</i> : <i>positive</i>}
      <input aria-label="amount" onChange={(event) => setAmount(-Number(event.target.value))} />
    </div>
  );
};
