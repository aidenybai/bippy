import { useState } from "react";

class Flag {
  constructor(private readonly onSet: (value: boolean) => void) {}
  turnOn() {
    this.onSet(true);
  }
}

export const ClassHandler = () => {
  const [isDone, setIsDone] = useState(false);
  const [flag] = useState(() => new Flag(setIsDone));
  return (
    <div>
      <button onClick={() => flag.turnOn()}>go</button>
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const LocalInstance = () => {
  const [isDone, setIsDone] = useState(false);
  const flag = new Flag(setIsDone);
  return (
    <div>
      <button onClick={() => flag.turnOn()}>go</button>
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
