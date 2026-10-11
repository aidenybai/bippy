// @ts-nocheck
import { useState } from "react";
import { getName, getStatus, hasPermission, renderBadge, renderIcon } from "./api";

export const Gate = ({ role }: { role: string }) => {
  if (!hasPermission(role, "edit")) return <p>Read only</p>;
  return <p>Editable</p>;
};

export const Name = () => <p>{getName()}</p>;

export const Status = () => {
  const status = getStatus();
  if (status === undefined) return <p>Unknown</p>;
  return status === "busy" ? <p>Busy</p> : <p>Idle</p>;
};

export const Badge = () => <div>{renderBadge()}</div>;

export const Icon = () => <div>{renderIcon()}</div>;

export const HandlerCall = ({ role }: { role: string }) => {
  const [isSaved, setIsSaved] = useState(false);
  const save = () => {
    if (hasPermission(role, "edit")) setIsSaved(true);
  };
  return <button onClick={save}>{isSaved ? "Saved" : "Save"}</button>;
};

export const TwoActions = ({ role }: { role: string }) => {
  const can = (action: "edit" | "view") => hasPermission(role, action);
  return (
    <div>
      {can("edit") ? <p>Edit</p> : null}
      {can("view") ? <p>View</p> : null}
    </div>
  );
};

export const DomLookup = () => {
  const root = document.getElementById("root");
  return root ? <p>Mounted</p> : <p>Detached</p>;
};
