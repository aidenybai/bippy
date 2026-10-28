import { useState } from "react";

export const Toggle = () => {
  const [on, setOn] = useState(false);
  return <button onClick={() => setOn(!on)}>{on ? "On" : "Off"}</button>;
};
