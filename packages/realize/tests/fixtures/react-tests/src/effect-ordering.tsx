import { useEffect, useLayoutEffect, useState } from "react";

type Order = "none" | "layout" | "layout then passive" | "wrong";

type Phase = "none" | "created" | "destroyed" | "wrong";

type Log = "start" | "A" | "AB" | "AB-a" | "AB-ab" | "AB-abA" | "AB-abAB" | "wrong";

type Commits = "none" | "1" | "12" | "wrong";

export const LayoutBeforePassive = () => {
  const [order, setOrder] = useState<Order>("none");
  useLayoutEffect(() => {
    setOrder((current) => (current === "none" ? "layout" : "wrong"));
  }, []);
  useEffect(() => {
    setOrder((current) => (current === "layout" ? "layout then passive" : "wrong"));
  }, []);
  return (
    <p>
      {order === "none"
        ? "none"
        : order === "layout"
          ? "layout"
          : order === "layout then passive"
            ? "layout then passive"
            : "wrong"}
    </p>
  );
};

export const UnmountsPreviousEffect = () => {
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<Phase>("none");
  useEffect(() => {
    setPhase((current) => (current === "none" || current === "destroyed" ? "created" : "wrong"));
    return () => setPhase((current) => (current === "created" ? "destroyed" : "wrong"));
  }, [count]);
  return (
    <div>
      <button onClick={() => setCount((current) => current + 1)}>increment</button>
      <p>{count === 0 ? "zero" : count === 1 ? "one" : "other"}</p>
      <p>
        {phase === "none"
          ? "none"
          : phase === "created"
            ? "created"
            : phase === "destroyed"
              ? "destroyed"
              : "wrong"}
      </p>
    </div>
  );
};

export const UnmountsAllBeforeCreatingAny = () => {
  const [count, setCount] = useState(0);
  const [log, setLog] = useState<Log>("start");
  useEffect(() => {
    setLog((current) => (current === "start" ? "A" : current === "AB-ab" ? "AB-abA" : "wrong"));
    return () => setLog((current) => (current === "AB" ? "AB-a" : "wrong"));
  }, [count]);
  useEffect(() => {
    setLog((current) => (current === "A" ? "AB" : current === "AB-abA" ? "AB-abAB" : "wrong"));
    return () => setLog((current) => (current === "AB-a" ? "AB-ab" : "wrong"));
  }, [count]);
  return (
    <div>
      <button onClick={() => setCount((current) => current + 1)}>increment</button>
      <p>{count === 0 ? "zero" : count === 1 ? "one" : "other"}</p>
      <p>
        {log === "start"
          ? "start"
          : log === "A"
            ? "A"
            : log === "AB"
              ? "AB"
              : log === "AB-a"
                ? "AB-a"
                : log === "AB-ab"
                  ? "AB-ab"
                  : log === "AB-abA"
                    ? "AB-abA"
                    : log === "AB-abAB"
                      ? "AB-abAB"
                      : "wrong"}
      </p>
    </div>
  );
};

export const MultipleEffectsInOrder = () => {
  const [commits, setCommits] = useState<Commits>("none");
  useEffect(() => {
    setCommits((current) => (current === "none" ? "1" : "wrong"));
  }, []);
  useEffect(() => {
    setCommits((current) => (current === "1" ? "12" : "wrong"));
  }, []);
  return (
    <p>{commits === "none" ? "none" : commits === "1" ? "1" : commits === "12" ? "12" : "wrong"}</p>
  );
};

export const SkipsEffectWhenDepsAreSame = () => {
  const [label, setLabel] = useState<"a" | "b">("a");
  const [other, setOther] = useState(0);
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    setRuns((current) => current + 1);
  }, [label]);
  return (
    <div>
      <button onClick={() => setOther((current) => current + 1)}>other</button>
      <button onClick={() => setLabel("b")}>label</button>
      <p>{label === "a" ? "label a" : "label b"}</p>
      <p>{other === 0 ? "other zero" : other === 1 ? "other one" : "other more"}</p>
      <p>
        {runs === 0 ? "runs zero" : runs === 1 ? "runs one" : runs === 2 ? "runs two" : "runs more"}
      </p>
    </div>
  );
};

export const EffectWithoutDepsRunsEveryCommit = () => {
  const [value, setValue] = useState(0);
  const [synced, setSynced] = useState(0);
  useEffect(() => {
    if (synced !== value) setSynced(value);
  });
  return (
    <div>
      <button onClick={() => setValue(1)}>set</button>
      <p>{value === 0 ? "value zero" : "value one"}</p>
      <p>{synced === 0 ? "synced zero" : "synced one"}</p>
    </div>
  );
};

export const EffectReadsLatestDeps = () => {
  const [count, setCount] = useState(1);
  const [state, setState] = useState(-1);
  useEffect(() => {
    setState(count);
  }, [count]);
  return (
    <div>
      <button onClick={() => setCount(2)}>two</button>
      <p>{count === 1 ? "count one" : "count two"}</p>
      <p>
        {state === -1
          ? "state none"
          : state === 1
            ? "state one"
            : state === 2
              ? "state two"
              : "state other"}
      </p>
    </div>
  );
};
