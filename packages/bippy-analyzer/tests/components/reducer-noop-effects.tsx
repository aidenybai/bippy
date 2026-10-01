import { useEffect, useReducer, useRef, useState } from "react";

export default () => {
  const effectCount = useRef(0);
  const [state, dispatch] = useReducer((previous: number) => previous, 0);
  const [observed, setObserved] = useState(0);
  useEffect(() => {
    effectCount.current++;
  });
  useEffect(() => {
    const update = setTimeout(() => dispatch(), 5);
    const observe = setTimeout(() => setObserved(effectCount.current), 15);
    return () => {
      clearTimeout(update);
      clearTimeout(observe);
    };
  }, []);
  return (
    <main>
      <span>{state}</span>
      {observed}
    </main>
  );
};
