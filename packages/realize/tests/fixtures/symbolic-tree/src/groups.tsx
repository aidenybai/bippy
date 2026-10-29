import { useState } from "react";
import { hasPermission } from "./permissions";
import type { Role } from "./permissions";

interface Status {
  isSaving: boolean;
  error: string | null;
}

declare const useStatus: () => Status;

export const Toolbar = ({ role }: { role: Role }) => {
  const status = useStatus();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  return (
    <div>
      {role === "admin" && <span>Admin</span>}
      {hasPermission(role, "edit") ? <button>Edit</button> : <span>Read only</span>}
      {status.isSaving && <span>Saving</span>}
      {status.error ? <p>{status.error}</p> : null}
      <button onClick={() => setIsHelpOpen(!isHelpOpen)}>Help</button>
      {isHelpOpen && <p>Press E to edit</p>}
    </div>
  );
};
