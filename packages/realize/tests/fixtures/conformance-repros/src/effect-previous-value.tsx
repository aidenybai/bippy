import { useEffect, useRef, useState } from "react";

export const PreviousCountRef = () => {
  const [count, setCount] = useState(0);
  const [wentUp, setWentUp] = useState(false);
  const previous = useRef(0);
  useEffect(() => {
    setWentUp(count > previous.current);
    previous.current = count;
  }, [count]);
  return <button onClick={() => setCount((count + 1) % 3)}>{wentUp ? "up" : "flat"}</button>;
};

export const PreviousCountLet = () => {
  const [count, setCount] = useState(0);
  const [wentUp, setWentUp] = useState(false);
  let last = 0;
  useEffect(() => {
    setWentUp(count > last);
    last = count;
  }, [count]);
  return <button onClick={() => setCount((count + 1) % 3)}>{wentUp ? "up" : "flat"}</button>;
};

export const PreviousCountCleanup = () => {
  const [count, setCount] = useState(0);
  const [wentUp, setWentUp] = useState(false);
  const previous = useRef(0);
  useEffect(() => {
    setWentUp(count > previous.current);
    return () => {
      previous.current = count;
    };
  }, [count]);
  return <button onClick={() => setCount((count + 1) % 3)}>{wentUp ? "up" : "flat"}</button>;
};
