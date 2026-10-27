import { useEffect, useState } from "react";

export const CopyOnClick = () => {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  return (
    <div>
      {x - y === 0 ? <i>synced</i> : <i>lag</i>}
      {x - y >= 1 ? <i>ahead</i> : null}
      <button onClick={() => setX(x + 1)}>a</button>
      <button onClick={() => setY(x)}>b</button>
    </div>
  );
};

export const CopyInEffect = () => {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  useEffect(() => {
    setY(x);
  }, [x]);
  return (
    <div>
      {x - y === 0 ? <i>synced</i> : <i>lag</i>}
      {x - y >= 1 ? <i>ahead</i> : null}
      <button onClick={() => setX(x + 1)}>a</button>
    </div>
  );
};
