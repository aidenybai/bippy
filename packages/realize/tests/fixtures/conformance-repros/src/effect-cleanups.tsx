import { useEffect, useState } from "react";

export const CleanupOnDeps = () => {
  const [isArmed, setIsArmed] = useState(false);
  const [mode, setMode] = useState("a");
  useEffect(
    () => () => {
      setMode("c");
    },
    [isArmed],
  );
  return (
    <div>
      <button onClick={() => setIsArmed(true)}>go</button>
      {mode === "c" ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const BodyThenCleanup = () => {
  const [isArmed, setIsArmed] = useState(false);
  const [mode, setMode] = useState("a");
  useEffect(() => {
    setMode("b");
    return () => {
      setMode("c");
    };
  }, [isArmed]);
  return (
    <div>
      <button onClick={() => setIsArmed(true)}>go</button>
      {mode === "b" ? <i>body</i> : mode === "c" ? <i>Z1</i> : <i>initial</i>}
    </div>
  );
};

export const MountOnly = () => {
  const [isArmed, setIsArmed] = useState(false);
  const [mode, setMode] = useState("a");
  useEffect(
    () => () => {
      setMode("c");
    },
    [],
  );
  return (
    <div>
      <button onClick={() => setIsArmed(!isArmed)}>go</button>
      {mode === "c" ? <i>Z1</i> : <i>no</i>}
    </div>
  );
};

export const CleanupReadsPreviousRender = () => {
  const [flag, setFlag] = useState(true);
  const [count, setCount] = useState(0);
  useEffect(() => {
    return () => {
      if (flag) setCount(1);
    };
  }, [flag]);
  return (
    <div>
      <button onClick={() => setFlag(!flag)}>toggle</button>
      <button onClick={() => setCount(0)}>reset</button>
      {flag ? (
        count === 1 ? (
          <i>yes one</i>
        ) : (
          <i>yes zero</i>
        )
      ) : count === 1 ? (
        <i>no one</i>
      ) : (
        <i>no zero</i>
      )}
    </div>
  );
};

export const CleanupFromEarlierRender = () => {
  const [flag, setFlag] = useState(true);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!flag) return;
    return () => setCount(1);
  }, [flag]);
  return (
    <div>
      <button onClick={() => setFlag(!flag)}>toggle</button>
      <button onClick={() => setCount(0)}>reset</button>
      {flag ? (
        count === 1 ? (
          <i>yes one</i>
        ) : (
          <i>yes zero</i>
        )
      ) : count === 1 ? (
        <i>no one</i>
      ) : (
        <i>no zero</i>
      )}
    </div>
  );
};
