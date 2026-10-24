import { useMemo, useState } from "react";

export const MemoCounter = () => {
  const box = useMemo(() => ({ clicks: 0 }), []);
  return (
    <div>
      <button
        onClick={() => {
          box.clicks += 1;
        }}
      >
        click
      </button>
      {box.clicks > 0 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const MemoCounterWithRender = () => {
  const [isOn, setIsOn] = useState(false);
  const box = useMemo(() => ({ clicks: 0 }), []);
  return (
    <div>
      <button
        onClick={() => {
          box.clicks += 1;
          setIsOn(!isOn);
        }}
      >
        click
      </button>
      {box.clicks > 0 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const MemoReflectSet = () => {
  const [isOn, setIsOn] = useState(false);
  const box = useMemo(() => ({ clicks: 0 }), []);
  return (
    <div>
      <button onClick={() => Reflect.set(box, "clicks", 1)}>set</button>
      <button onClick={() => setIsOn(!isOn)}>toggle</button>
      {box.clicks > 0 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const MemoObjectAssign = () => {
  const [isOn, setIsOn] = useState(false);
  const box = useMemo(() => ({ clicks: 0 }), []);
  return (
    <div>
      <button onClick={() => Object.assign(box, { clicks: 1 })}>assign</button>
      <button onClick={() => setIsOn(!isOn)}>toggle</button>
      {box.clicks > 0 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
