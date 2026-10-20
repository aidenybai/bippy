import { useState } from "react";

export const LayoutBadge = ({ layout }: { layout: string }) => {
  const [isOpen, setOpen] = useState(false);
  return (
    <div>
      {layout !== "legacy" ? <span>Modern</span> : null}
      {layout === "legacy" ? <span>Legacy</span> : null}
      <button onClick={() => setOpen(!isOpen)}>{isOpen ? "Hide" : "Show"}</button>
    </div>
  );
};

export const StatusBadge = ({ status }: { status: string }) => (
  <div>
    {status === "active" && <b>Active</b>}
    {status !== "active" && <i>Inactive</i>}
  </div>
);
