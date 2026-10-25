import { useMemo, useRef, useState } from "react";

export const MemoActions = () => {
  const [isOn, setIsOn] = useState(false);
  const actions = useMemo(() => ({ toggle: () => setIsOn(!isOn) }), [isOn]);
  return <button onClick={() => actions.toggle()}>{isOn ? "on" : "off"}</button>;
};

export const LazyStateActions = () => {
  const [isOn, setIsOn] = useState(false);
  const [actions] = useState(() => ({ toggle: () => setIsOn((value) => !value) }));
  return <button onClick={() => actions.toggle()}>{isOn ? "on" : "off"}</button>;
};

export const LazyStateList = () => {
  const [isOn, setIsOn] = useState(false);
  const [actions] = useState(() => [() => setIsOn((value) => !value)]);
  return (
    <button onClick={() => actions.forEach((action) => action())}>{isOn ? "on" : "off"}</button>
  );
};

export const FilledList = () => {
  const [isOn, setIsOn] = useState(false);
  const [actions, setActions] = useState<Array<() => void>>([]);
  return (
    <div>
      <button onClick={() => setActions([...actions, () => setIsOn((value) => !value)])}>
        add
      </button>
      <button onClick={() => actions.forEach((action) => action())}>{isOn ? "on" : "off"}</button>
    </div>
  );
};

export const FilledMap = () => {
  const [isOn, setIsOn] = useState(false);
  const [actions, setActions] = useState(new Map<string, () => void>());
  return (
    <div>
      <button
        onClick={() => setActions(new Map(actions).set("a", () => setIsOn((value) => !value)))}
      >
        add
      </button>
      <button onClick={() => actions.get("a")?.()}>{isOn ? "on" : "off"}</button>
    </div>
  );
};

export const RefListeners = () => {
  const [isOn, setIsOn] = useState(false);
  const listeners = useRef<Array<() => void>>([]);
  return (
    <div>
      <button onClick={() => listeners.current.push(() => setIsOn((value) => !value))}>add</button>
      <button onClick={() => listeners.current.forEach((listener) => listener())}>
        {isOn ? "on" : "off"}
      </button>
    </div>
  );
};
