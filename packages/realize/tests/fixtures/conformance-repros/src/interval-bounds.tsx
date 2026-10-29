import { useState } from "react";

export const ClampedMax = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(Math.min(count + 1, 5))}>add</button>
      <button onClick={() => setCount(0)}>reset</button>
      {count >= 5 ? <i>full</i> : <i>open</i>}
    </div>
  );
};

export const ClampedMin = () => {
  const [count, setCount] = useState(3);
  return (
    <div>
      <button onClick={() => setCount(Math.max(count - 1, 0))}>drop</button>
      <button onClick={() => setCount(3)}>reset</button>
      {count > 0 ? <i>some</i> : <i>none</i>}
    </div>
  );
};

export const LastPage = () => {
  const [page, setPage] = useState(0);
  return (
    <div>
      <button onClick={() => setPage(page + 1 < 3 ? page + 1 : page)}>next</button>
      <button onClick={() => setPage(0)}>first</button>
      {page + 1 >= 3 ? <i>last</i> : <i>more</i>}
    </div>
  );
};
