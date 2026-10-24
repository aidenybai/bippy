import { useState } from "react";

export const FindRun = () => {
  const [pick, setPick] = useState("a");
  const options = [
    { name: "b", run: () => setPick("b") },
    { name: "c", run: () => setPick("c") },
  ];
  return (
    <div>
      <button onClick={() => options.find((option) => option.name === "b")?.run()}>b</button>
      <button onClick={() => options.find((option) => option.name === "c")?.run()}>c</button>
      {pick === "a" ? <i>L1</i> : pick === "b" ? <i>L2</i> : <i>L3</i>}
    </div>
  );
};

export const FindNone = () => {
  const [pick, setPick] = useState("a");
  const options = [{ name: "b", run: () => setPick("b") }];
  return (
    <div>
      <button onClick={() => options.find((option) => option.name === "z")?.run()}>z</button>
      {pick === "a" ? <i>L1</i> : <i>L2</i>}
    </div>
  );
};

export const FindInRender = () => {
  const [pick, setPick] = useState("a");
  const options = [
    { name: "b", run: () => setPick("b") },
    { name: "c", run: () => setPick("c") },
  ];
  const next = options.find((option) => option.name === "c");
  return (
    <div>
      <button onClick={next?.run}>next</button>
      {pick === "c" ? <i>L3</i> : <i>L1</i>}
    </div>
  );
};

export const FindByState = () => {
  const [mode, setMode] = useState("b");
  const [pick, setPick] = useState("a");
  const actions = [
    { name: "b", run: () => setPick("b") },
    { name: "c", run: () => setPick("c") },
  ];
  return (
    <div>
      <button onClick={() => actions.find((action) => action.name === mode)?.run()}>run</button>
      <button onClick={() => setMode(mode === "b" ? "c" : "b")}>switch</button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};
