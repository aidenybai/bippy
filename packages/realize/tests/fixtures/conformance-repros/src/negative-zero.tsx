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
