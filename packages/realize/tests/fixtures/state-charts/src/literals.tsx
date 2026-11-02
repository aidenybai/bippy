import { useState } from "react";
import type { ReactNode } from "react";

type Filter = "all" | "active" | "done";

export const FilterLabel = () => {
  const [filter, setFilter] = useState<Filter>("all");
  return (
    <div>
      <p>{filter}</p>
      <button onClick={() => setFilter("active")}>Active</button>
      <button onClick={() => setFilter("done")}>Done</button>
    </div>
  );
};

export const Inbox = () => {
  const withFallback = (content: ReactNode) => content ?? <em>Empty</em>;
  return <section>{withFallback(null)}</section>;
};

export const StatusBanner = () => {
  const [status] = useState<"ok" | "error">("ok");
  return status === "error" ? <p>Error</p> : <p>Fine</p>;
};

export const TitleCard = ({ title }: { title: string | null }) =>
  title === "" ? <p>Untitled</p> : <h1>{title}</h1>;

export const RoleBadge = ({ role }: { role: string | null }) =>
  role === "admin" ? <strong>Admin</strong> : <span>Member</span>;
