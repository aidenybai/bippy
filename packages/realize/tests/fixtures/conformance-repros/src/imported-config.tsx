import { useState } from "react";
import { DEFAULTS, LOCAL, SHARED } from "./imported-config-values";

export const ConfigInitial = () => {
  const [count, setCount] = useState(DEFAULTS.size + 1);
  return <button onClick={() => setCount(count + 1)}>{count === 3 ? "start" : "moved"}</button>;
};

export const ConfigLength = () => {
  const [count, setCount] = useState(DEFAULTS.tags.length);
  return <button onClick={() => setCount(0)}>{count === 2 ? "start" : "reset"}</button>;
};

export const ConfigMode = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      {DEFAULTS.mode === "grid" ? <i>grid</i> : <i>list</i>}
      <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "open" : "closed"}</button>
    </div>
  );
};

export const SharedInitial = () => {
  const [count, setCount] = useState(SHARED.size);
  return <button onClick={() => setCount(0)}>{count === 2 ? "start" : "reset"}</button>;
};

export const LocalWrite = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      {LOCAL.size === 2 ? <i>two</i> : <i>more</i>}
      <button
        onClick={() => {
          LOCAL.size += 1;
          setIsOpen(!isOpen);
        }}
      >
        {isOpen ? "open" : "closed"}
      </button>
    </div>
  );
};
