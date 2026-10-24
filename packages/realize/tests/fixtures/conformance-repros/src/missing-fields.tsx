import { useState } from "react";

interface Box {
  open: boolean;
  extra?: boolean;
}

export const MissingField = () => {
  const [box, setBox] = useState<Box>({ open: true });
  return (
    <div>
      <button onClick={() => setBox({ ...box, extra: true })}>extra</button>
      {box.extra ? <i>extra</i> : <i>plain</i>}
    </div>
  );
};
