import { useState } from "react";

const createSwitch = () => {
  let on = false;
  return {
    flip: () => {
      on = !on;
    },
    get on() {
      return on;
    },
  };
};

const lamp = createSwitch();

const fan = new (class {
  on = false;
  flip() {
    this.on = !this.on;
  }
})();

export const ClosureSwitch = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {lamp.on ? <b>on</b> : <s>off</s>}
      <button
        onClick={() => {
          lamp.flip();
          setTick(tick + 1);
        }}
      >
        flip
      </button>
    </div>
  );
};

export const AnonymousClassSwitch = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {fan.on ? <b>on</b> : <s>off</s>}
      <button
        onClick={() => {
          fan.flip();
          setTick(tick + 1);
        }}
      >
        flip
      </button>
    </div>
  );
};
