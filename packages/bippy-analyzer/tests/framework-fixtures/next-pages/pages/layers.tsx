import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function Layers() {
  const [target, setTarget] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setTarget(document.querySelector(".tooltips"));
  }, []);
  return (
    <main>
      <p>page</p>
      {target ? createPortal(<span>tip</span>, target) : null}
    </main>
  );
}
