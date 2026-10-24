import { useState } from "react";

export const SetterInMap = () => {
  const [isOn, setIsOn] = useState(false);
  const setters = new Map([["on", setIsOn]]);
  return <button onClick={() => setters.get("on")?.(!isOn)}>{isOn ? "on" : "off"}</button>;
};

export const SetterFromMapGet = () => {
  const [isOn, setIsOn] = useState(false);
  const setters = new Map([["on", setIsOn]]);
  return (
    <button
      onClick={() => {
        const setter = setters.get("on");
        if (setter) setter(!isOn);
      }}
    >
      {isOn ? "on" : "off"}
    </button>
  );
};

export const SetterInSet = () => {
  const [isOn, setIsOn] = useState(false);
  return (
    <button onClick={() => new Set([setIsOn]).forEach((setter) => setter(!isOn))}>
      {isOn ? "on" : "off"}
    </button>
  );
};
