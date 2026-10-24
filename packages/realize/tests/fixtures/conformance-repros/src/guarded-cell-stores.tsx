import { useRef, useState } from "react";

export const GuardedRefStore = () => {
  const [flag, setFlag] = useState(false);
  const [isAbove, setIsAbove] = useState(false);
  const count = 1;
  const last = useRef(0);
  return (
    <div>
      <button onClick={() => setFlag(!flag)}>flag</button>
      <button
        onClick={() => {
          last.current = count;
          if (flag) last.current = 0;
          setIsAbove(count > last.current);
        }}
      >
        check
      </button>
      {isAbove ? <i>above</i> : null}
    </div>
  );
};

export const GuardedLetStore = () => {
  const [flag, setFlag] = useState(false);
  const [isAbove, setIsAbove] = useState(false);
  let last = 1;
  return (
    <div>
      <button onClick={() => setFlag(!flag)}>flag</button>
      <button
        onClick={() => {
          if (flag) last = 0;
          setIsAbove(1 > last);
        }}
      >
        check
      </button>
      {isAbove ? <i>above</i> : null}
    </div>
  );
};
