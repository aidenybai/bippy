import { useState } from "react";

export const PaddedSpreadKey = ({ rest }: { rest: string[] }) => {
  const [label, setLabel] = useState("none");
  const items = ["first", "second", ...rest];
  return (
    <button onClick={() => setLabel(items["01" as unknown as number] ?? "missing")}>{label}</button>
  );
};
