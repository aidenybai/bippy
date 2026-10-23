import { useState } from "react";

export const SelectedIds = () => {
  const [ids, setIds] = useState<Set<number>>(() => new Set([2]));
  return (
    <div>
      <button onClick={() => setIds((previous) => new Set(previous).add(1))}>add</button>
      {ids.size === 0 ? <i>none</i> : ids.has(1) ? <i>one</i> : <i>other</i>}
    </div>
  );
};

export const Scores = () => {
  const [scores, setScores] = useState(new Map([["a", 1]]));
  return (
    <div>
      <button onClick={() => setScores((previous) => new Map(previous).set("a", 2))}>bump</button>
      {scores.get("a") === 1 ? <i>first</i> : <i>later</i>}
    </div>
  );
};

export const SearchQuery = () => {
  const [params] = useState(() => new URLSearchParams("q=a"));
  return <div>{params.get("q") === "a" ? <i>a</i> : <i>other</i>}</div>;
};

export const FilledSet = () => {
  const [seen, setSeen] = useState(() => {
    const initial = new Set<string>();
    initial.add("x");
    return initial;
  });
  return (
    <div>
      <button onClick={() => setSeen(new Set())}>clear</button>
      {seen.has("x") ? <i>seen</i> : <i>unseen</i>}
    </div>
  );
};

export const LocalSet = ({ isTagged }: { isTagged: boolean }) => {
  const always = new Set<string>();
  always.add("y");
  const sometimes = new Set<string>();
  if (isTagged) sometimes.add("y");
  return (
    <div>
      {always.has("y") ? <i>always</i> : <i>never</i>}
      {sometimes.has("y") ? <b>tagged</b> : <b>untagged</b>}
    </div>
  );
};
