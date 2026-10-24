import { useState } from "react";

export const SequentialIfs = ({ count }: { count: number }) => {
  const [isOn, setIsOn] = useState(false);
  const [mode, setMode] = useState<"a" | "b">("a");
  return (
    <div>
      <button
        onClick={() => {
          if (count <= 2) setMode("b");
          if (!isOn) setIsOn(true);
        }}
      >
        go
      </button>
      {mode === "a" ? <i>A</i> : isOn ? <i>yes</i> : <i>half</i>}
      {!isOn && <b>off</b>}
    </div>
  );
};

export const IfElse = () => {
  const [isOn, setIsOn] = useState(false);
  const [mode, setMode] = useState<"a" | "b">("a");
  return (
    <div>
      <button
        onClick={() => {
          if (isOn) setMode("b");
          else setIsOn(true);
        }}
      >
        go
      </button>
      {mode === "a" ? isOn ? <i>on</i> : <i>off</i> : <i>b</i>}
    </div>
  );
};

export const GuardThenReturn = () => {
  const [isOn, setIsOn] = useState(true);
  const [count, setCount] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          if (count === 0) setCount(1);
          if (count > 0) return;
          setIsOn(false);
        }}
      >
        go
      </button>
      {isOn && count === 0 ? (
        <i>on zero</i>
      ) : isOn ? (
        <i>on one</i>
      ) : count === 0 ? (
        <i>off zero</i>
      ) : (
        <i>off one</i>
      )}
    </div>
  );
};

export const GuardedSetThenRead = () => {
  const [isOn, setIsOn] = useState(false);
  const [count, setCount] = useState(2);
  return (
    <div>
      <button
        onClick={() => {
          setIsOn(true);
          if (count !== 0) setIsOn(false);
          if (!isOn) setCount(1);
        }}
      >
        go
      </button>
      {isOn && count === 1 ? (
        <i>on one</i>
      ) : isOn ? (
        <i>on other</i>
      ) : count === 1 ? (
        <i>off one</i>
      ) : (
        <i>off other</i>
      )}
    </div>
  );
};

export const GuardedUpdaterThenRead = () => {
  const [isOn, setIsOn] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          setIsOn(true);
          if (count === 0) setIsOn((value) => value && count !== 2);
          if (!isOn) setCount(2);
        }}
      >
        go
      </button>
      {isOn && count === 2 ? (
        <i>on two</i>
      ) : isOn ? (
        <i>on other</i>
      ) : count === 2 ? (
        <i>off two</i>
      ) : (
        <i>off other</i>
      )}
    </div>
  );
};
