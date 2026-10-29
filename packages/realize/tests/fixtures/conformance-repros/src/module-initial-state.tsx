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

const INITIAL_SCORE = { points: 0, isLocked: false };

export const ResetToModuleObject = () => {
  const [score, setScore] = useState(INITIAL_SCORE);
  return (
    <div>
      <button onClick={() => setScore({ ...score, points: score.points + 1 })}>add</button>
      <button onClick={() => setScore(INITIAL_SCORE)}>reset</button>
      {score.points === 0 ? <i>empty</i> : <i>scored</i>}
    </div>
  );
};

const INITIAL_TALLY = { points: 0 };

export const MutatedBeforeReset = () => {
  const [tally, setTally] = useState(INITIAL_TALLY);
  return (
    <div>
      <button
        onClick={() => {
          tally.points = 2;
          setTally({ ...tally });
        }}
      >
        bump
      </button>
      <button onClick={() => setTally(INITIAL_TALLY)}>reset</button>
      {tally.points === 0 ? <i>empty</i> : <i>scored</i>}
    </div>
  );
};
