import { useState } from "react";

export const ForOfBreakValue = () => {
  const [flag, setFlag] = useState(true);
  const [list] = useState<number[]>([1]);
  const pickPositive = () => {
    let local = 1;
    for (const item of list) {
      if (item > 0) {
        local = item;
        break;
      }
    }
    setFlag(local > 0);
  };
  return <button onClick={pickPositive}>{flag ? "yes" : "no"}</button>;
};
