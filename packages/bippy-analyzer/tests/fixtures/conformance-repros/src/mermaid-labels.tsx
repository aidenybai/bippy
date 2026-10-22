import { useState } from "react";

export const ColonText = () => {
  const [label, setLabel] = useState("start");
  return (
    <div>
      <button onClick={() => setLabel("x")}>save: now</button>
      {label === "x" ? <p>time: 12:30</p> : <p>no</p>}
    </div>
  );
};
