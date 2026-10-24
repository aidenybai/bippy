import { useMemo } from "react";

export const DiffStats = ({ items }: { items: string[] }) => {
  const stats = useMemo(() => {
    let additions = 0;
    items.forEach((item) => {
      additions += item.length;
    });
    return { additions };
  }, [items]);
  return <p>{stats.additions > 0 ? "Changed" : "No changes"}</p>;
};
