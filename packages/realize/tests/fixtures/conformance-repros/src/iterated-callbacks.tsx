import { useState } from "react";

export const LoopedActions = () => {
  const [isOn, setIsOn] = useState(false);
  const toggle = () => {
    const actions = [() => setIsOn(!isOn)];
    for (const action of actions) action();
  };
  return <button onClick={toggle}>{isOn ? "on" : "off"}</button>;
};

export const LoopedSetters = () => {
  const [isOn, setIsOn] = useState(false);
  const toggle = () => {
    for (const update of [setIsOn]) update(!isOn);
  };
  return <button onClick={toggle}>{isOn ? "on" : "off"}</button>;
};

export const SetOfSetters = () => {
  const [isOn, setIsOn] = useState(false);
  const toggle = () => {
    new Set([setIsOn]).forEach((update) => update(!isOn));
  };
  return <button onClick={toggle}>{isOn ? "on" : "off"}</button>;
};

export const LoopedSetOfSetters = () => {
  const [isOn, setIsOn] = useState(false);
  const toggle = () => {
    for (const update of new Set([setIsOn])) update(!isOn);
  };
  return <button onClick={toggle}>{isOn ? "on" : "off"}</button>;
};
