import { useState } from "react";

class ParamActions {
  constructor(private set: (value: number) => void) {}
  one = () => this.set(1);
  two = () => this.set(2);
}

class AssignedActions {
  set: (value: number) => void;
  constructor(set: (value: number) => void) {
    this.set = set;
  }
  one = () => this.set(1);
  two = () => this.set(2);
}

export const ParamField = () => {
  const [n, setN] = useState(0);
  const actions = new ParamActions(setN);
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={actions.two}>step</button>
    </div>
  );
};

export const AssignedField = () => {
  const [n, setN] = useState(0);
  const actions = new AssignedActions(setN);
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={actions.two}>step</button>
    </div>
  );
};

export const ChosenField = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const actions = new ParamActions(setN);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={k === 0 ? actions.one : actions.two}>step</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};

class CreatedActions {
  constructor(private step: (index: number) => void) {}
  one = () => this.step(1);
  two = () => this.step(2);
  static create(step: (index: number) => void) {
    return new CreatedActions(step);
  }
}

export const ChosenCallResult = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const actions = CreatedActions.create((index) => setN(n + index));
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={k === 0 ? actions.one : actions.two}>step</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};
