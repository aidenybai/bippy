import { useState } from "react";

export const JsxInArrayLiteral = () => {
  const [isDone, setIsDone] = useState(false);
  const elements = [
    <button key="go" onClick={() => setIsDone(true)}>
      go
    </button>,
  ];
  return (
    <div>
      {elements}
      {isDone ? <i>done</i> : <i>waiting</i>}
    </div>
  );
};

export const HandlerFromLiteralArray = () => {
  const [isDone, setIsDone] = useState(false);
  const handlers = [() => setIsDone(true)];
  return <button onClick={handlers[0]}>{isDone ? "done" : "waiting"}</button>;
};

export const MissingIndex = () => {
  const [isDone, setIsDone] = useState(false);
  const handlers = [() => setIsDone(true)];
  return <button onClick={handlers[1]}>{isDone ? "done" : "waiting"}</button>;
};
