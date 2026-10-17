import { useToggle } from "./hooks/use-toggle";

/**
 * A custom hook of the project runs as part of the component, so its state is the
 * component's state and the functions it returns change it.
 */

export function Disclosure() {
  const { isOn, label, toggle } = useToggle();
  return (
    <section>
      <button type="button" onClick={toggle}>
        {label}
      </button>
      {isOn ? <p>Details</p> : null}
    </section>
  );
}
