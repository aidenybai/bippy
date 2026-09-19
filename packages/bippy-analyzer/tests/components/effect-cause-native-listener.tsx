import { useEffect, useRef, useState } from "react";

interface FocusTrapProps {
  name: string;
}

const FocusTrap = ({ name }: FocusTrapProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focusCount, setFocusCount] = useState(0);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const retainFocus = (event: FocusEvent) => {
      if (event.target !== input) input.focus();
    };
    document.addEventListener("focusin", retainFocus);
    input.focus();
    return () => document.removeEventListener("focusin", retainFocus);
  }, []);
  return (
    <section data-name={name}>
      <input ref={inputRef} onFocus={() => setFocusCount((count) => count + 1)} />
      {focusCount > 0 ? <strong /> : <span />}
    </section>
  );
};

export default () => {
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  return <main>{context ? <FocusTrap name="canvas" /> : <FocusTrap name="fallback" />}</main>;
};

export const isEnumerated = true;
