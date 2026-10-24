import { useState } from "react";

export const LoopPushedHandler = () => {
  const [slot, setSlot] = useState(-1);
  const handlers: Array<() => void> = [];
  let index = 0;
  for (; index < 2; index++) handlers.push(() => setSlot(index));
  return <button onClick={handlers[0]}>{slot === 2 ? "two" : slot === 0 ? "zero" : "none"}</button>;
};

export const VarLoopHandler = () => {
  const [slot, setSlot] = useState(-1);
  const handlers: Array<() => void> = [];
  for (let index = 0; index < 2; index++) handlers.push(() => setSlot(index));
  return <button onClick={handlers[0]}>{slot === 2 ? "two" : slot === 0 ? "zero" : "none"}</button>;
};

export const LetAfterLoop = () => {
  const [slot, setSlot] = useState(-1);
  let last = 0;
  for (let i = 0; i < 2; i++) last = i;
  const pick = () => setSlot(last);
  return <button onClick={pick}>{slot === 1 ? "one" : "none"}</button>;
};
