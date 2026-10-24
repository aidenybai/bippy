import { useDeferredValue, useEffect, useEffectEvent, useOptimistic, useState } from "react";

export const OptimisticFollowsValue = () => {
  const [flag, setFlag] = useState(false);
  const [shown] = useOptimistic(flag);
  return <button onClick={() => setFlag(!flag)}>{shown ? "yes" : "no"}</button>;
};

export const DeferredFollowsValue = () => {
  const [count, setCount] = useState(0);
  const deferred = useDeferredValue(count);
  return (
    <button onClick={() => setCount((count + 1) % 3)}>{deferred === 2 ? "two" : "other"}</button>
  );
};

export const EffectEventReadsLatest = () => {
  const [count, setCount] = useState(0);
  const [isOn, setIsOn] = useState(false);
  const onCount = useEffectEvent(() => {
    if (count === 2) setIsOn(true);
  });
  useEffect(() => {
    onCount();
  }, [count]);
  return <button onClick={() => setCount((count + 1) % 3)}>{isOn ? "on" : "off"}</button>;
};
