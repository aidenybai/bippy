import { useEffect, useReducer, useRef, useState } from "react";

export const SetterInRef = () => {
  const [isOn, setIsOn] = useState(false);
  const saved = useRef<(value: boolean) => void>(() => {});
  useEffect(() => {
    saved.current = setIsOn;
  }, []);
  return (
    <div>
      <button onClick={() => saved.current(!isOn)}>flip</button>
      {isOn ? <i>on</i> : <i>off</i>}
    </div>
  );
};

const flip = (isOn: boolean, action: "flip") => (action === "flip" ? !isOn : isOn);

export const DispatchInRef = () => {
  const [isOn, dispatch] = useReducer(flip, false);
  const saved = useRef(dispatch);
  return (
    <div>
      <button onClick={() => saved.current("flip")}>flip</button>
      {isOn ? <i>on</i> : <i>off</i>}
    </div>
  );
};

let sharedSet: (value: boolean) => void = () => {};

export const SetterInModule = () => {
  const [isOn, setIsOn] = useState(false);
  sharedSet = setIsOn;
  return (
    <div>
      <button onClick={() => sharedSet(!isOn)}>flip</button>
      {isOn ? <i>on</i> : <i>off</i>}
    </div>
  );
};
