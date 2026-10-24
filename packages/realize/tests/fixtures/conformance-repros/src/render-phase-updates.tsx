import { useState } from "react";

export const RenderPhase = () => {
  const [count, setCount] = useState(0);
  const [previousCount, setPreviousCount] = useState(count);
  if (previousCount !== count) setPreviousCount(count);
  return (
    <button onClick={() => setCount(count + 1)}>
      {previousCount !== count ? <i>between</i> : <i>settled</i>}
    </button>
  );
};

export const ResetOnChange = ({ itemId }: { itemId: string }) => {
  const [previousId, setPreviousId] = useState(itemId);
  const [isOpen, setOpen] = useState(false);
  if (previousId !== itemId) {
    setPreviousId(itemId);
    setOpen(false);
  }
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      {isOpen && previousId === itemId ? <i>open</i> : <i>closed</i>}
    </div>
  );
};

export const CopiedDuringRender = () => {
  const [source, setSource] = useState(false);
  const [copy, setCopy] = useState(false);
  if (source !== copy) setCopy(source);
  return (
    <div>
      <button onClick={() => setSource(true)}>set</button>
      {copy ? <i>copied</i> : <i>empty</i>}
    </div>
  );
};
