import { useReducer } from "react";

interface WizardState {
  step: "details" | "payment" | "done";
  hasError: boolean;
}

type WizardAction = { type: "next" } | { type: "back" } | { type: "fail" };

const reducer = (state: WizardState, action: WizardAction): WizardState => {
  switch (action.type) {
    case "next":
      return { step: state.step === "details" ? "payment" : "done", hasError: false };
    case "back":
      return { ...state, step: "details" };
    case "fail":
      return { ...state, hasError: true };
  }
};

export const Wizard = () => {
  const [state, dispatch] = useReducer(reducer, { step: "details", hasError: false });
  if (state.step === "done") return <p>Thanks!</p>;
  return (
    <form>
      {state.hasError && <p role="alert">Something went wrong</p>}
      {state.step === "details" ? <input name="name" /> : <input name="card" />}
      {state.step === "payment" && (
        <button type="button" onClick={() => dispatch({ type: "back" })}>
          Back
        </button>
      )}
      <button type="button" onClick={() => dispatch({ type: "next" })}>
        Next
      </button>
    </form>
  );
};
