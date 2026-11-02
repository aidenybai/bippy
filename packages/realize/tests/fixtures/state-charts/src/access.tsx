import { useState } from "react";
import { hasPermission } from "./permissions";
import type { Role } from "./permissions";

export const EditButton = ({ role }: { role: Role }) => {
  const [isEditing, setIsEditing] = useState(false);
  if (!hasPermission(role, "edit")) return <p>Read only</p>;
  return isEditing ? (
    <button onClick={() => setIsEditing(false)}>Save</button>
  ) : (
    <button onClick={() => setIsEditing(true)}>Edit</button>
  );
};
