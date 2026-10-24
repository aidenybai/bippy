import { useState } from "react";

export const ForOfBreakValue = () => {
  const [flag, setFlag] = useState(true);
  const [n, setN] = useState(0);
  const [list, setList] = useState<number[]>([1]);
  return (
    <div>
      <button
        onClick={() => {
          let local = 1;
          for (const item of list) {
            if (item > 0) {
              local = item;
              break;
            }
          }
          setFlag(local > 0);
        }}
      >
        btn0
      </button>
      <button onClick={() => setN((n + 1) % 3)}>btn1</button>
      {flag ? <i>yes</i> : <i>no</i>}
      {list.length > 1 ? <i>L3</i> : null}
    </div>
  );
};
