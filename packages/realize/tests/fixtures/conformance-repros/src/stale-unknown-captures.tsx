import { useCallback, useMemo, useState } from "react";

export const StaleDerivedCallback = () => {
  const [isOn, setIsOn] = useState(false);
  const [count, setCount] = useState(0);
  const isFresh = useMemo(() => !isOn && count !== 1, [isOn]);
  const advance = useCallback(() => {
    if (isFresh) setIsOn(true);
    else setCount(0);
  }, [count]);
  return (
    <div>
      <button onClick={advance}>advance</button>
      <button onClick={() => setCount(1)}>one</button>
      <button onClick={() => setCount(2)}>two</button>
      {isOn ? <i>on</i> : count === 0 ? <i>zero</i> : isFresh ? <i>fresh</i> : <i>stale</i>}
    </div>
  );
};
