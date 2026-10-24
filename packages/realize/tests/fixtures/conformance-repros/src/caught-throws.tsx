import { useState } from "react";

export const ThrowCatch = () => {
  const [isOn, setIsOn] = useState(false);
  const getWord = () => {
    try {
      if (isOn) throw new Error("x");
      return "fine";
    } catch {
      return "caught";
    }
  };
  return <button onClick={() => setIsOn(!isOn)}>{getWord()}</button>;
};

export const ThrownValue = () => {
  const [isOn, setIsOn] = useState(false);
  const getWord = () => {
    try {
      throw isOn;
    } catch (error) {
      return error ? "on" : "off";
    }
  };
  return <button onClick={() => setIsOn(!isOn)}>{getWord()}</button>;
};

export const HandlerThrow = ({ name }: { name: string }) => {
  const [status, setStatus] = useState("idle");
  const save = () => {
    try {
      if (!name) throw new Error("Name is required");
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  };
  return <button onClick={save}>{status}</button>;
};
