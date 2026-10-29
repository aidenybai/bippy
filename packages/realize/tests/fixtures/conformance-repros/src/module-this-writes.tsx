import { useState } from "react";

const flags = {
  open: false,
  toggle() {
    this.open = !this.open;
  },
};

const settings = {
  view: {
    open: false,
    toggle() {
      this.open = !this.open;
    },
  },
};

class Panel {
  open = false;
  toggle() {
    this.open = !this.open;
  }
}

const panel = new Panel();

export const ToggledFlag = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {flags.open ? <b>open</b> : <s>closed</s>}
      <button
        onClick={() => {
          flags.toggle();
          setTick(tick + 1);
        }}
      >
        toggle
      </button>
    </div>
  );
};

export const NestedFlag = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {settings.view.open ? <b>open</b> : <s>closed</s>}
      <button
        onClick={() => {
          settings.view.toggle();
          setTick(tick + 1);
        }}
      >
        toggle
      </button>
    </div>
  );
};

export const ClassFlag = () => {
  const [tick, setTick] = useState(0);
  return (
    <div>
      {panel.open ? <b>open</b> : <s>closed</s>}
      <button
        onClick={() => {
          panel.toggle();
          setTick(tick + 1);
        }}
      >
        toggle
      </button>
    </div>
  );
};
