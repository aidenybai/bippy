import { useState } from "react";

interface Size {
  width?: number;
  height?: number;
  radius?: number;
}

export const SizeForm = () => {
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const apply = (updates: Size) => {
    if ("width" in updates) setSize({ ...size, height: (updates.width ?? 1) * 2 });
    else setSize({ ...size, ...updates });
  };
  return (
    <div>
      <button onClick={() => apply({ radius: 2 })}>round</button>
      <button onClick={() => apply({ width: 3 })}>wide</button>
      <span>{size.height}</span>
    </div>
  );
};

export const EntryLabel = ({ label }: { label: string }) => {
  const entry = { label };
  return (
    <p>
      {"label" in entry ? <b>{label}</b> : <i>{label}</i>}
      {"toString" in entry ? <em>listed</em> : null}
    </p>
  );
};
