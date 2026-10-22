import { useReducer, useState } from "react";

const incrementReducer = (state: number, action: "increment"): number =>
  action === "increment" ? state + 1 : state;

export const RestartsUntilStable = () => {
  const [count, setCount] = useState(0);
  if (count < 3) setCount(count + 1);
  return <p>{count === 3 ? "three" : count < 3 ? "less" : "more"}</p>;
};

export const UpdatesManyTimesInOneRender = () => {
  const [count, setCount] = useState(0);
  if (count < 12) {
    setCount((current) => current + 1);
    setCount((current) => current + 1);
    setCount((current) => current + 1);
  }
  return <p>{count === 12 ? "twelve" : count < 12 ? "less" : "more"}</p>;
};

export const RenderPhaseReducer = () => {
  const [count, dispatch] = useReducer(incrementReducer, 0);
  if (count < 3) dispatch("increment");
  return <p>{count === 3 ? "three" : count < 3 ? "less" : "more"}</p>;
};

export const ProcessesRestAfterRenderPhaseUpdate = () => {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  if (a !== b) setB(a);
  const [c, setC] = useState(false);
  return (
    <div>
      <button
        onClick={() => {
          setA(true);
          setC(true);
        }}
      >
        update
      </button>
      <p>{a ? "A" : "a"}</p>
      <p>{b ? "B" : "b"}</p>
      <p>{c ? "C" : "c"}</p>
    </div>
  );
};

export const RestartsWithNewUpdatesOnTop = () => {
  const [row, setRow] = useState(1);
  const [renderedRow, setRenderedRow] = useState<number | null>(null);
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  if (renderedRow !== row) {
    setIsScrollingDown(renderedRow !== null && row > renderedRow);
    setRenderedRow(row);
  }
  return (
    <div>
      <button onClick={() => setRow(5)}>five</button>
      <button onClick={() => setRow(2)}>two</button>
      <p>{isScrollingDown ? "down" : "up"}</p>
    </div>
  );
};
