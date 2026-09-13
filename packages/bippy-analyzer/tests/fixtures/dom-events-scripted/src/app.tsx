import { useEffect, useRef, useState } from "react";

export const App = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasLeft, setHasLeft] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  useEffect(() => {
    const input = inputRef.current!;
    const onFocusOut = () => setHasLeft(true);
    const onFocus = () => setIsFocused(true);
    input.addEventListener("focusout", onFocusOut);
    input.addEventListener("focus", onFocus);
    input.focus();
    return () => {
      input.removeEventListener("focusout", onFocusOut);
      input.removeEventListener("focus", onFocus);
    };
  }, []);
  return (
    <form>
      <input ref={inputRef} />
      {hasLeft && <em>left</em>}
      {isFocused && <strong>focused</strong>}
    </form>
  );
};
