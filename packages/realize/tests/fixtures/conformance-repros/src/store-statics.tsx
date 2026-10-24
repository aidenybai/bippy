import { create } from "zustand";

interface Panel {
  open: boolean;
  pinned: boolean;
  toggleOpen: () => void;
  togglePinned: () => void;
}

const usePanel = create<Panel>((set) => ({
  open: false,
  pinned: false,
  toggleOpen: () => set((state) => ({ open: !state.open })),
  togglePinned: () => set((state) => ({ pinned: !state.pinned })),
}));

export const GetStateToggle = () => {
  const open = usePanel((state) => state.open);
  return (
    <div>
      <button onClick={() => usePanel.getState().toggleOpen()}>toggle</button>
      {open ? <i>open</i> : <i>closed</i>}
    </div>
  );
};

export const SetStateUpdater = () => {
  const open = usePanel((state) => state.open);
  return (
    <div>
      <button onClick={() => usePanel.setState((state) => ({ open: !state.open }))}>toggle</button>
      {open ? <i>open</i> : <i>closed</i>}
    </div>
  );
};

export const TwoActions = () => {
  const open = usePanel((state) => state.open);
  const pinned = usePanel((state) => state.pinned);
  const toggleOpen = usePanel((state) => state.toggleOpen);
  const togglePinned = usePanel((state) => state.togglePinned);
  return (
    <div>
      <button
        onClick={() => {
          toggleOpen();
          togglePinned();
        }}
      >
        both
      </button>
      {open ? <i>open</i> : <i>closed</i>}
      {pinned ? <i>pinned</i> : <i>loose</i>}
    </div>
  );
};

export const TwoSetStates = () => {
  const open = usePanel((state) => state.open);
  const pinned = usePanel((state) => state.pinned);
  return (
    <div>
      <button
        onClick={() => {
          usePanel.setState({ open: true });
          usePanel.setState({ pinned: true });
        }}
      >
        both
      </button>
      {open ? <i>open</i> : <i>closed</i>}
      {pinned ? <i>pinned</i> : <i>loose</i>}
    </div>
  );
};

interface Counter {
  on: boolean;
  count: number;
  items: number[];
  reset: () => void;
  flipIfZero: () => void;
}

const useCounter = create<Counter>((set) => ({
  on: true,
  count: 1,
  items: [],
  reset: () => set({ count: 0, on: false }),
  flipIfZero: () => set((state) => (state.count === 0 ? { on: !state.on } : state)),
}));

export const ResetThenFlip = () => {
  const on = useCounter((state) => state.on);
  const count = useCounter((state) => state.count);
  return (
    <div>
      <button
        onClick={() => {
          useCounter.getState().reset();
          useCounter.getState().flipIfZero();
        }}
      >
        reset
      </button>
      {on ? <i>on</i> : <i>off</i>}
      {count === 1 ? <i>one</i> : <i>other</i>}
    </div>
  );
};

export const EmptyItems = () => {
  const items = useCounter((state) => state.items);
  return <div>{items.length > 0 ? <i>some</i> : <i>none</i>}</div>;
};
