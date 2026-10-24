import { useMemo } from "react";

const formatDay = (timestamp: number) => new Date(timestamp).toDateString();

export const DateRange = ({ start, end }: { start: number; end: number }) => {
  const [from, to] = useMemo(
    () => (start > 0 ? [formatDay(start), formatDay(end)] : []),
    [start, end],
  );
  return <p>{from ? `${from} to ${to}` : "Any time"}</p>;
};
