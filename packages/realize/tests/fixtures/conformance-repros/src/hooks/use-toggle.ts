import { useState } from "react";

export function useToggle(initial = false) {
  const [isOn, setOn] = useState(initial);
  const toggle = () => setOn((current) => !current);
  const label = isOn ? "Hide" : "Show";
  return { isOn, label, toggle };
}
