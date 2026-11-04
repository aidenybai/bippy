import { useState } from "react";

export const CopiedSetterSink = () => {
  const [isOn, setIsOn] = useState(false);
  const sink = {
    set value(next: boolean) {
      setIsOn(next);
    },
  };
  const copy: { value?: boolean } = { ...sink };
  return <button onClick={() => (copy.value = !isOn)}>{isOn ? "on" : "off"}</button>;
};

export const SetterStateKeys = () => {
  const [config] = useState({
    set mode(next: string) {
      console.log(next);
    },
    size: 1,
  });
  const [firstKey, setFirstKey] = useState("none");
  return <button onClick={() => setFirstKey(Object.keys(config)[0] ?? "none")}>{firstKey}</button>;
};
