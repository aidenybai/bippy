import { useState } from "react";

export const InfiniteGap = () => {
  const [total, setTotal] = useState(0);
  const [used, setUsed] = useState(0);
  return (
    <div>
      <button onClick={() => setTotal(1e999)}>unlimited total</button>
      <button onClick={() => setUsed(1e999)}>unlimited use</button>
      {total >= used + 1 ? total > used ? <i>more</i> : <i>both infinite</i> : <i>less</i>}
    </div>
  );
};

export const FiniteGap = () => {
  const [total, setTotal] = useState(0);
  const [used, setUsed] = useState(0);
  return (
    <div>
      <button onClick={() => setTotal(5)}>five</button>
      <button onClick={() => setUsed(3)}>three</button>
      {total >= used + 1 ? total > used ? <i>more</i> : <i>never</i> : <i>less</i>}
    </div>
  );
};
