import { useState } from "react";

export const RemainingSeats = () => {
  const [used, setUsed] = useState(0);
  return (
    <div>
      <button onClick={() => setUsed(used + 1)}>take</button>
      <button onClick={() => setUsed(0)}>clear</button>
      {10 - used > 0 ? <i>open</i> : <i>full</i>}
      {used >= 10 ? <b>closed</b> : null}
    </div>
  );
};

export const NegatedBalance = () => {
  const [balance, setBalance] = useState(3);
  return (
    <div>
      <button onClick={() => setBalance(balance - 1)}>spend</button>
      {-balance < 0 ? <i>funded</i> : <i>empty</i>}
      {balance > 0 ? <b>positive</b> : null}
    </div>
  );
};
