import { useReducer, useState } from "react";

export const HoleState = () => {
  const [, setTick] = useState(0);
  return <button onClick={() => setTick(1)}>Tick</button>;
};

export const UnreadState = () => {
  const [isSaved, setIsSaved] = useState(false);
  return <button onClick={() => setIsSaved(true)}>Save</button>;
};

export const HoleReducer = () => {
  const [, dispatch] = useReducer((count: number) => count + 1, 0);
  return <button onClick={() => dispatch()}>Tick</button>;
};
