import { useEffect, useReducer } from "react";
import { EventEmitter } from "./shared/node-events";

const feed = new EventEmitter();

interface PanelState {
  title: string;
  selected: string | null;
  isPinned: boolean;
}

interface SelectAction {
  type: "select";
  item: string;
}

interface PinAction {
  type: "pin";
}

const reducePanel = (state: PanelState, action: SelectAction | PinAction): PanelState => {
  switch (action.type) {
    case "select":
      return { ...state, selected: action.item };
    case "pin":
      return { ...state, isPinned: true };
  }
};

export const isPartial = true;
export const stateCount = 5;

/**
 * Dispatches from code the analysis does not follow carry object-literal
 * actions: the reducer runs on them, so the fields an action leaves alone stay
 * known and only the field it sets from an unknown argument is uncertain.
 */
export default function EscapedReducerActions() {
  const [state, dispatch] = useReducer(reducePanel, {
    title: "Inbox",
    selected: null,
    isPinned: false,
  });
  useEffect(() => {
    const handleSelect = (item: string) => dispatch({ type: "select", item });
    const handlePin = () => dispatch({ type: "pin" });
    feed.on("select", handleSelect);
    feed.on("pin", handlePin);
    return () => {
      feed.off("select", handleSelect);
      feed.off("pin", handlePin);
    };
  }, []);
  return (
    <section>
      <h1>{state.title}</h1>
      {state.selected === null ? <em>none</em> : <b>{state.selected}</b>}
      {state.isPinned ? <mark>pinned</mark> : null}
    </section>
  );
}
