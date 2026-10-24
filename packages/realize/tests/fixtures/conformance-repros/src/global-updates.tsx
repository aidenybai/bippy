import { useState } from "react";

let clicks = 0;

export const IncrementedGlobal = () => {
  const [, setTick] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          clicks++;
          setTick((tick) => tick + 1);
        }}
      >
        click
      </button>
      {clicks > 0 ? <i>clicked</i> : <i>fresh</i>}
    </div>
  );
};
