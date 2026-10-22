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
