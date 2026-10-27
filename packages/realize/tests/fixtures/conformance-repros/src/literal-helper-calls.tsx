import { useState } from "react";
import { getRole, signIn } from "./literal-helper-store";

const double = (value: number) => value * 2;

const sumTo = (limit: number) => {
  let total = 0;
  for (let index = 1; index <= limit; index += 1) total += index;
  return total;
};

let clicks = 0;
const getClicks = () => clicks;

const log: number[] = [];
const getLogSize = () => log.length;

let renders = 0;
const countRender = () => ++renders;

export const LiteralDouble = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      {double(2) === 4 ? <i>four</i> : <i>other</i>}
      {isOpen ? <i>open</i> : <i>closed</i>}
      <button onClick={() => setIsOpen(!isOpen)}>toggle</button>
    </div>
  );
};

export const LiteralLoop = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      {sumTo(2) === 3 ? <i>three</i> : <i>other</i>}
      {isOpen ? <i>open</i> : <i>closed</i>}
      <button onClick={() => setIsOpen(!isOpen)}>toggle</button>
    </div>
  );
};

export const LiteralInitial = () => {
  const [count, setCount] = useState(double(1));
  return (
    <div>
      {count === 2 ? <i>two</i> : count === 3 ? <i>three</i> : <i>more</i>}
      <button onClick={() => setCount(count + 1)}>add</button>
    </div>
  );
};

export const ModuleLetGetter = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {getClicks() === 0 ? <i>none</i> : <i>some</i>}
      <button
        onClick={() => {
          clicks += 1;
          setTick(tick + 1);
        }}
      >
        a
      </button>
    </div>
  );
};

export const ModuleArrayGetter = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {getLogSize() === 0 ? <i>none</i> : <i>some</i>}
      <button
        onClick={() => {
          log.push(1);
          setTick(tick + 1);
        }}
      >
        a
      </button>
    </div>
  );
};

export const RenderCounter = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {countRender() === 1 ? <i>first</i> : <i>later</i>}
      <button onClick={() => setTick(tick + 1)}>a</button>
    </div>
  );
};

export const ImportedGetter = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {getRole() === "guest" ? <i>guest</i> : <i>member</i>}
      <button
        onClick={() => {
          signIn();
          setTick(tick + 1);
        }}
      >
        a
      </button>
    </div>
  );
};
