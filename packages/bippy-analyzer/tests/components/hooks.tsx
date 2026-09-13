import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { useToggle } from "./shared/use-toggle";

interface State {
  items: string[];
}

const reducer = (state: State): State => state;

const Form = () => {
  const id = useId();
  const [value, setValue] = useState("");
  const [state] = useReducer(reducer, { items: ["a", "b"] });
  const inputRef = useRef<HTMLInputElement>(null);
  const upper = useMemo(() => value.toUpperCase(), [value]);
  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
    [],
  );
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <form>
      <label htmlFor={id}>Name</label>
      <input id={id} ref={inputRef} value={value} onChange={onChange} />
      <p>{upper}</p>
      <ul>
        {state.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </form>
  );
};

const Toggler = () => {
  const [isOn, toggle] = useToggle(false);
  return (
    <button type="button" onClick={toggle}>
      {isOn ? "on" : "off"}
    </button>
  );
};

export default function Hooks() {
  return (
    <div>
      <Form />
      <Toggler />
    </div>
  );
}
