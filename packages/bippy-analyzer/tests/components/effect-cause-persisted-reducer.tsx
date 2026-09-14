import { useEffect, useReducer, useState } from "react";

interface Selection {
  first: boolean;
  second: boolean;
}

interface TriggerProps {
  name: keyof Selection;
  select: (name: keyof Selection) => void;
}

const select = (selection: Selection, name: keyof Selection): Selection => ({
  ...selection,
  [name]: true,
});

const Trigger = ({ name, select }: TriggerProps) => {
  useEffect(() => select(name), [name, select]);
  return <canvas />;
};

export default () => {
  const [selection, dispatch] = useReducer(select, { first: false, second: false });
  const [firstContext] = useState(() => document.createElement("canvas").getContext("2d"));
  const [secondContext] = useState(() => document.createElement("canvas").getContext("2d"));
  const [hasTicked, setTicked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTicked(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main>
      {firstContext ? <Trigger name="first" select={dispatch} /> : <aside />}
      {secondContext ? <Trigger name="second" select={dispatch} /> : <aside />}
      <section>
        {selection.first ? <strong>first selected</strong> : <span>first idle</span>}
      </section>
      <section>
        {selection.second ? <strong>second selected</strong> : <span>second idle</span>}
      </section>
      {hasTicked ? <footer>ticked</footer> : null}
    </main>
  );
};

export const isEnumerated = true;
