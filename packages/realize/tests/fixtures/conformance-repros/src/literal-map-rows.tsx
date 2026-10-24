import { useState } from "react";

export const MappedHandlers = () => {
  const [pick, setPick] = useState("a");
  const handlers = ["b", "c"].map((value) => () => setPick(value));
  return (
    <div>
      <button onClick={handlers[0]}>pb</button>
      <button onClick={handlers[1]}>pc</button>
      {pick === "a" ? <i>L1</i> : pick === "b" ? <i>L2</i> : <i>L3</i>}
    </div>
  );
};

export const CalledMappedHandler = () => {
  const [pick, setPick] = useState("a");
  const handlers = ["b", "c"].map((value) => () => setPick(value));
  return (
    <div>
      <button onClick={() => handlers[1]()}>pc</button>
      {pick === "c" ? <i>L3</i> : <i>L1</i>}
    </div>
  );
};

export const ActionRows = () => {
  const [isDone, setIsDone] = useState(false);
  const actions = [{ name: "go", run: () => setIsDone(true) }];
  return (
    <div>
      {actions.map((action) => (
        <button key={action.name} onClick={() => action.run()}>
          {action.name}
        </button>
      ))}
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const PassedRows = () => {
  const [pick, setPick] = useState("a");
  return (
    <div>
      {[
        { name: "b", run: () => setPick("b") },
        { name: "c", run: () => setPick("c") },
      ].map((action) => (
        <button key={action.name} onClick={action.run}>
          {action.name}
        </button>
      ))}
      {pick === "a" ? <i>L1</i> : pick === "b" ? <i>L2</i> : <i>L3</i>}
    </div>
  );
};

export const CheckedRows = ({ value }: { value: string }) => (
  <ul>
    {[
      { pattern: /[0-9]/, text: "number" },
      { pattern: /[a-z]/, text: "lowercase" },
    ].map((rule) => (
      <li key={rule.text}>
        {rule.text} {rule.pattern.test(value) ? "met" : "unmet"}
      </li>
    ))}
  </ul>
);
