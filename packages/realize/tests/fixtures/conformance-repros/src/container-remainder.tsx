import { useRef, useState } from "react";

export const RefFieldListener = () => {
  const [isOn, setIsOn] = useState(false);
  const listeners = useRef<{ toggle?: () => void }>({});
  return (
    <div>
      <button onClick={() => (listeners.current.toggle = () => setIsOn((value) => !value))}>
        add
      </button>
      <button onClick={() => listeners.current.toggle?.()}>{isOn ? "on" : "off"}</button>
    </div>
  );
};

export const RefObjectValues = () => {
  const [isOn, setIsOn] = useState(false);
  const listeners = useRef({ first: () => setIsOn((value) => !value) });
  return (
    <button onClick={() => Object.values(listeners.current).forEach((listener) => listener())}>
      {isOn ? "on" : "off"}
    </button>
  );
};

export const MapValuesLoop = () => {
  const [isOn, setIsOn] = useState(false);
  const [actions] = useState(() => new Map([["toggle", () => setIsOn((value) => !value)]]));
  return (
    <button
      onClick={() => {
        for (const action of actions.values()) action();
      }}
    >
      {isOn ? "on" : "off"}
    </button>
  );
};
