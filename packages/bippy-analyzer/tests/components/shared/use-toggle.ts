import { useCallback, useState } from "react";

export const useToggle = (initial: boolean): [boolean, () => void] => {
  const [isOn, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((previous) => !previous), []);
  return [isOn, toggle];
};
