import { useEffect, useRef, useState } from "react";

export const App = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasLeft, setHasLeft] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    const input = inputRef.current!;
    const onFocusOut = () => setHasLeft(true);
    const onFocus = () => setIsFocused(true);
    const onSelectionChange = () => setHasSelection(true);
    input.addEventListener("focusout", onFocusOut);
    input.addEventListener("focus", onFocus);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      input.removeEventListener("focusout", onFocusOut);
      input.removeEventListener("focus", onFocus);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);
  return (
    <form>
      <input ref={inputRef} />
      {hasLeft && <em>left</em>}
      {isFocused && <strong>focused</strong>}
      {hasSelection && <small>selected</small>}
    </form>
  );
};
