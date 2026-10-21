import { useState } from "react";

export const TemplateCompare = () => {
  const [mode, setMode] = useState<"a" | "b">("a");
  const key = `${mode}-panel`;
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {key === "a-panel" ? <i>first</i> : <i>second</i>}
    </div>
  );
};

export const TemplateCount = ({ count }: { count: number }) => {
  const text = `${count}`;
  return <p>{text ? <i>{text}</i> : <i>none</i>}</p>;
};

export const TemplateStatic = () => {
  const label = `panel`;
  return <p>{label === "panel" ? <i>yes</i> : <i>no</i>}</p>;
};
