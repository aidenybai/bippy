import { useReducer, useState } from "react";

const INITIAL_PANEL = { count: 0, isOpen: false };

const panelReducer = (state: typeof INITIAL_PANEL, action: "toggle" | "reset") =>
  action === "reset" ? INITIAL_PANEL : { ...state, isOpen: !state.isOpen };

export const ReducerFromModuleObject = () => {
  const [panel, dispatch] = useReducer(panelReducer, INITIAL_PANEL);
  return (
    <div>
      <button onClick={() => dispatch("toggle")}>toggle</button>
      <button onClick={() => dispatch("reset")}>reset</button>
      {panel.isOpen ? <i>open</i> : <i>closed</i>}
    </div>
  );
};

const INITIAL_FORM = { name: "ann", isAdmin: false };

export const StateFromModuleObject = () => {
  const [form, setForm] = useState(() => INITIAL_FORM);
  return (
    <button onClick={() => setForm({ ...form, isAdmin: !form.isAdmin })}>
      {form.isAdmin ? "admin" : "member"}
    </button>
  );
};
