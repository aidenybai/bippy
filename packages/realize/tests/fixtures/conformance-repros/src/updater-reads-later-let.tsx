import { useState } from "react";

export const UpdaterReadsLocalLet = () => {
  const [isOn, setIsOn] = useState(false);
  return (
    <button
      onClick={() => {
        let armed = true;
        setIsOn(() => armed);
        armed = false;
      }}
    >
      {isOn ? "on" : "off"}
    </button>
  );
};

export const UpdaterReadsComponentLet = () => {
  const [isOn, setIsOn] = useState(false);
  let armed = true;
  return (
    <button
      onClick={() => {
        setIsOn(() => armed);
        armed = false;
      }}
    >
      {isOn ? "on" : "off"}
    </button>
  );
};
