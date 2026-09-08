import { useEffect, useRef, useState } from "react";

const TimerElapsed = () => {
  const [, rerender] = useState({});
  const started = useRef<number | null>(null);
  const elapsed = useRef<number | null>(null);
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    started.current = Date.now();
    setTimeout(() => {
      elapsed.current = Date.now() - (started.current ?? 0);
      rerender({});
    }, 50);
  }, []);
  return (
    <div>
      {elapsed.current === null ? <s /> : elapsed.current >= 50 ? <b /> : <i />}
      {elapsed.current === null ? <s /> : elapsed.current < 0 ? <b /> : <i />}
      {isMounted.current ? <u /> : <em />}
    </div>
  );
};
export default TimerElapsed;
