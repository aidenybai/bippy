import { useState } from "react";

type Mode = "a" | "b";

export const TrimCases = () => {
  const [value, setValue] = useState("");
  return (
    <div>
      <button onClick={() => setValue("  ")}>space</button>
      <button onClick={() => setValue("")}>clear</button>
      {value.trim() === "" ? <i>blank</i> : <i>filled</i>}
    </div>
  );
};

export const UpperMode = () => {
  const [mode, setMode] = useState<Mode>("a");
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {mode.toUpperCase() === "A" ? <i>first</i> : <i>second</i>}
    </div>
  );
};

export const LiteralTrim = () => ("  ".trim() === "" ? <i>blank</i> : <i>filled</i>);

export const OpenPrefix = ({ path }: { path: string }) =>
  path.startsWith("/") ? <i>absolute</i> : <i>relative</i>;
