import { useState } from "react";

export const Bubbling = () => {
  const [inner, setInner] = useState(false);
  const [outer, setOuter] = useState(false);
  return (
    <div>
      <section onClick={() => setOuter(true)}>
        <button onClick={() => setInner(true)}>go</button>
      </section>
      {inner && outer ? (
        <i>both</i>
      ) : inner ? (
        <i>inneronly</i>
      ) : outer ? (
        <i>outeronly</i>
      ) : (
        <i>none</i>
      )}
    </div>
  );
};

export const Stopped = () => {
  const [inner, setInner] = useState(false);
  const [outer, setOuter] = useState(false);
  return (
    <div>
      <section onClick={() => setOuter(true)}>
        <button
          onClick={(event) => {
            event.stopPropagation();
            setInner(true);
          }}
        >
          go
        </button>
      </section>
      {inner && outer ? (
        <i>both</i>
      ) : inner ? (
        <i>inneronly</i>
      ) : outer ? (
        <i>outeronly</i>
      ) : (
        <i>none</i>
      )}
    </div>
  );
};

export const Captured = () => {
  const [order, setOrder] = useState("");
  return (
    <div>
      <section onClickCapture={() => setOrder("outer")}>
        <button onClick={() => setOrder((current) => current + "-inner")}>go</button>
      </section>
      {order === "outer-inner" ? <i>ordered</i> : order === "" ? <i>none</i> : <i>Z1</i>}
    </div>
  );
};

export const StoppedByAncestor = () => {
  const [isOn, setIsOn] = useState(true);
  const [count, setCount] = useState(0);
  return (
    <section onClick={() => setIsOn(true)}>
      <div
        onClick={(event) => {
          setCount(2);
          event.stopPropagation();
        }}
      >
        <button onClick={() => setIsOn(false)}>go</button>
      </div>
      {isOn ? <i>on</i> : <i>off</i>}
      {count === 2 ? <b>two</b> : <b>zero</b>}
    </section>
  );
};
