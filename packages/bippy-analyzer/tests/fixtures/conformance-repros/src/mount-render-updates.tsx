import { useState } from "react";

export const RenderSetOnMount = () => {
  const [on, setOn] = useState(true);
  const [seen, setSeen] = useState(0);
  if (on && seen !== -1) {
    setSeen(-1);
  }
  return (
    <div>
      <button onClick={() => setOn(!on)}>flip</button>
      {seen === -1 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const RenderSetAlways = () => {
  const [seen, setSeen] = useState(0);
  if (seen !== -1) setSeen(-1);
  return <div>{seen === -1 ? <i>yes</i> : <i>no</i>}</div>;
};
