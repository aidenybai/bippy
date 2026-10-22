import { useState } from "react";

export const ControlledCheckbox = () => {
  const [flag, setFlag] = useState(true);
  return (
    <div>
      <input
        type="checkbox"
        aria-label="flag"
        checked={flag}
        onChange={(event) => setFlag(event.target.checked)}
      />
      {flag ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const FixedCheckbox = () => {
  const [mode, setMode] = useState<"a" | "b">("a");
  return (
    <div>
      <input
        type="checkbox"
        aria-label="fixed"
        checked
        onChange={(event) => setMode(event.target.checked ? "b" : "a")}
      />
      {mode === "b" ? <i>b</i> : <i>a</i>}
    </div>
  );
};

export const UncheckedRadio = () => {
  const [mode, setMode] = useState<"a" | "b">("b");
  return (
    <div>
      <input
        type="radio"
        aria-label="radio"
        checked={false}
        onChange={(event) => setMode(event.target.checked ? "a" : "b")}
      />
      {mode === "b" ? <i>b</i> : <i>a</i>}
    </div>
  );
};

export const RadioValue = () => {
  const [mode, setMode] = useState<"a" | "b">("a");
  return (
    <div>
      <input
        type="radio"
        aria-label="a"
        value="a"
        onChange={(event) => setMode(event.target.value === "b" ? "b" : "a")}
      />
      {mode === "b" ? <i>b</i> : <i>a</i>}
    </div>
  );
};
