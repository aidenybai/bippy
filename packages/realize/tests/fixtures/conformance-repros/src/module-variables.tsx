import { useState, useSyncExternalStore } from "react";

let clicks = 0;

export const ModuleCounter = () => {
  const [, setTick] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          clicks += 1;
          setTick((value) => value + 1);
        }}
      >
        click
      </button>
      {clicks > 0 ? <i>clicked</i> : <i>fresh</i>}
    </div>
  );
};

let isOn = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const toggle = () => {
  isOn = !isOn;
  for (const listener of listeners) listener();
};

export const ExternalToggle = () => {
  const on = useSyncExternalStore(subscribe, () => isOn);
  return (
    <div>
      <button onClick={toggle}>toggle</button>
      {on ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
