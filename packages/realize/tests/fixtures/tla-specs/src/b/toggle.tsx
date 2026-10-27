import { useState } from "react";

export const Toggle = () => {
  const [on, setOn] = useState(false);
  return <button onClick={() => setOn(true)}>{on ? "On" : "Turn on"}</button>;
};
