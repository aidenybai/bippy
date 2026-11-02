import { useState, type MutableRefObject, type RefObject } from "react";

export const Latest = ({ latest }: { latest: MutableRefObject<number> }) => {
  const [count, setCount] = useState(0);
  const bump = () => {
    latest.current = count;
    setCount(count + 1);
  };
  return <button onClick={bump}>{count}</button>;
};

export const Seen = ({ seen, id }: { seen: RefObject<Set<string> | null>; id: string }) => {
  const [shown, setShown] = useState(false);
  const show = () => {
    seen.current?.add(id);
    setShown(true);
  };
  return <button onClick={show}>{shown ? "shown" : "show"}</button>;
};

export const Box = ({ box }: { box: { current: number } }) => {
  const [count, setCount] = useState(0);
  const bump = () => {
    box.current = count;
    setCount(count + 1);
  };
  return <button onClick={bump}>{count}</button>;
};
