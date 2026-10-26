import { useRef, useState } from "react";

const log: number[] = [];

const seen = new Set<number>();

let clicks = 0;

const getClicks = (tick: number) => (tick >= 0 ? clicks : -1);

export const PushedLog = () => {
  const [other, setOther] = useState(0);
  return (
    <button
      onClick={() => {
        log.push(1);
        setOther(other + 1);
      }}
    >
      {log.length === 0 ? "empty" : "logged"}
    </button>
  );
};

export const SeenSet = () => {
  const [other, setOther] = useState(0);
  return (
    <button
      onClick={() => {
        seen.add(1);
        setOther(other + 1);
      }}
    >
      {seen.has(1) ? "seen" : "new"}
    </button>
  );
};

export const HelperClicks = () => {
  const [tick] = useState(0);
  const [other, setOther] = useState(0);
  return (
    <button
      onClick={() => {
        clicks += 1;
        setOther(other + 1);
      }}
    >
      {getClicks(tick) === 0 ? "none" : "some"}
    </button>
  );
};

export const RefLog = () => {
  const entries = useRef<number[]>([]);
  const [other, setOther] = useState(0);
  return (
    <button
      onClick={() => {
        entries.current.push(1);
        setOther(other + 1);
      }}
    >
      {entries.current.length === 0 ? "empty" : "logged"}
    </button>
  );
};
