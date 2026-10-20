import { useState } from "react";

interface Preset {
  id: string;
}

export const QuickPick = ({
  preset,
  assistant,
}: {
  preset: Preset | null;
  assistant: Preset | null;
}) => {
  const [isOpen, setOpen] = useState(false);
  return (
    <div>
      {preset || assistant ? <p>{(preset || (assistant as Preset)).id}</p> : null}
      <button onClick={() => setOpen(!isOpen)}>{isOpen ? "Hide" : "Show"}</button>
    </div>
  );
};
