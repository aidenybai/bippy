import { useState } from "react";

const NEXT = { idle: "busy", busy: "done" };
enum Tone {
  Calm = "calm",
  Loud = "loud",
}

export const EntriesFind = () => {
  const [mode, setMode] = useState("idle");
  return (
    <button
      onClick={() => setMode(Object.entries(NEXT).find(([, to]) => to === "busy")?.[0] ?? "x")}
    >
      {mode}
    </button>
  );
};

export const ProbeTests = () => {
  const [x, setX] = useState(0);
  const [flag, setFlag] = useState(false);
  return (
    <button
      onClick={() => {
        setX(x === 0 ? 2 : 0);
        setFlag(!flag);
      }}
    >
      {~[0, 2].indexOf(x) ? "member" : "never"}
      {x ** 2 <= 4 ? "power" : "never"}
      {(x | 2) >= 2 ? "or" : "never"}
      {+flag <= 1 ? "plus" : "never"}
      {10 - x >= 8 ? "minus" : "never"}
      {Object.keys(Tone)[0] === "Calm" ? "keys" : "never"}
    </button>
  );
};
