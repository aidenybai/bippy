import { useMemo, useReducer, useRef, useState } from "react";
import { makeSetter } from "./handler-call-factory";

const makeLocalSetter = (setValue: (value: number) => void, value: number) => () => setValue(value);

const everyOther = (run: () => void) => {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls % 2 === 0) run();
  };
};

const addBy = (total: number, by: number) => total + by;

export const CallStateMember = () => {
  const [n, setN] = useState(0);
  const [api] = useState({ run: (by: number) => setN(by) });
  return (
    <div>
      {n === 0 ? <i>zero</i> : <i>one</i>}
      <button onClick={() => api.run.call(null, 1)}>a</button>
    </div>
  );
};

export const ApplyRefMember = () => {
  const [n, setN] = useState(0);
  const api = useRef({ run: (by: number) => setN(by) });
  return (
    <div>
      {n === 0 ? <i>zero</i> : <i>one</i>}
      <button onClick={() => api.current.run.apply(null, [1])}>a</button>
    </div>
  );
};

export const BindMemoMember = () => {
  const [n, setN] = useState(0);
  const api = useMemo(() => ({ run: (by: number) => setN(by) }), []);
  return (
    <div>
      {n === 0 ? <i>zero</i> : <i>one</i>}
      <button onClick={() => api.run.bind(null, 1)()}>a</button>
    </div>
  );
};

export const TimeoutRefMember = () => {
  const [n, setN] = useState(0);
  const holder = useRef({ run: (by: number) => setN(by) });
  return (
    <div>
      {n === 0 ? <i>zero</i> : <i>one</i>}
      <button onClick={() => setTimeout(() => holder.current.run(1), 0)}>a</button>
    </div>
  );
};

export const ActionsObject = () => {
  const [n, setN] = useState(0);
  const api = { run: () => setN(1), other: () => setN(2) };
  return (
    <div>
      {n === 0 ? <i>zero</i> : n === 1 ? <i>one</i> : <i>two</i>}
      <button onClick={() => api.run()}>a</button>
      <button onClick={() => api.other()}>b</button>
    </div>
  );
};

export const ConditionalForEach = () => {
  const [n, setN] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const list = isFlipped ? [() => setN(1)] : [() => setN(2)];
  return (
    <div>
      {n === 0 ? <i>zero</i> : n === 1 ? <i>one</i> : <i>two</i>}
      <button onClick={() => list.forEach((item) => item())}>a</button>
      <button onClick={() => setIsFlipped(!isFlipped)}>flip</button>
    </div>
  );
};

export const MemoTableKey = () => {
  const [n, setN] = useState(0);
  const [mode, setMode] = useState("b");
  const table = useMemo<Record<string, () => void>>(
    () => ({ a: () => setN(1), b: () => setN(2) }),
    [],
  );
  return (
    <div>
      {n === 0 ? <i>zero</i> : n === 1 ? <i>one</i> : <i>two</i>}
      <button onClick={() => table[mode]?.()}>a</button>
      <button onClick={() => setMode(mode === "a" ? "b" : "a")}>mode</button>
    </div>
  );
};

export const ArrayAtIndex = () => {
  const [n, setN] = useState(0);
  const [index, setIndex] = useState(1);
  const table = [() => setN(1), () => setN(2)];
  return (
    <div>
      {n === 0 ? <i>zero</i> : n === 1 ? <i>one</i> : <i>two</i>}
      <button onClick={() => table.at(index)?.()}>a</button>
      <button onClick={() => setIndex(index === 0 ? 1 : 0)}>index</button>
    </div>
  );
};

export const EntriesMemoTable = () => {
  const [n, setN] = useState(0);
  const [mode] = useState("b");
  const table = useMemo(() => ({ a: () => setN(1), b: () => setN(2) }), []);
  return (
    <div>
      {n === 0 ? <i>zero</i> : n === 1 ? <i>one</i> : <i>two</i>}
      <button
        onClick={() => Object.entries(table).forEach(([name, run]) => name === mode && run())}
      >
        a
      </button>
    </div>
  );
};

export const MemoModuleFactory = () => {
  const [n, setN] = useState(0);
  const action = useMemo(() => makeLocalSetter(setN, 1), []);
  return (
    <div>
      {n === 0 ? <i>zero</i> : <i>one</i>}
      <button onClick={() => action()}>a</button>
    </div>
  );
};

export const EveryOtherMemo = () => {
  const [n, setN] = useState(0);
  const action = useMemo(() => everyOther(() => setN((previous) => previous + 1)), []);
  return (
    <div>
      {n === 0 ? <i>zero</i> : <i>more</i>}
      <button onClick={() => action()}>a</button>
    </div>
  );
};

export const IndexThenIndex = () => {
  const [n, setN] = useState(0);
  const table = [() => setN(1), () => setN(2)];
  return (
    <div>
      {n === 0 ? <i>zero</i> : n === 1 ? <i>one</i> : <i>two</i>}
      <button onClick={() => table[0]()}>a</button>
      <button onClick={() => table[1]()}>b</button>
    </div>
  );
};

export const SomeShortCircuit = () => {
  const [n, setN] = useState(0);
  const table = [() => setN(1), () => setN(2)];
  return (
    <div>
      {n === 0 ? <i>zero</i> : n === 1 ? <i>one</i> : <i>two</i>}
      <button onClick={() => table.some((run) => (run(), true))}>a</button>
    </div>
  );
};

export const ImportedFactory = () => {
  const [n, setN] = useState(0);
  const action = makeSetter(setN, 1);
  return (
    <div>
      {n === 0 ? <i>zero</i> : <i>one</i>}
      <button onClick={() => action()}>a</button>
    </div>
  );
};

export const DispatchForEach = () => {
  const [total, add] = useReducer(addBy, 0);
  return (
    <div>
      {total === 0 ? <i>zero</i> : <i>one</i>}
      <button onClick={() => [2].forEach(add)}>a</button>
    </div>
  );
};
