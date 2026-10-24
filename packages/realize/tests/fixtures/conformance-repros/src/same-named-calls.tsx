interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

const parseDate = (value: unknown): Date | undefined =>
  typeof value === "string" ? new Date(value) : undefined;

export const DateRangeLabel = ({ column }: { column: { getValues: () => unknown[] } }) => {
  const values = column.getValues();
  const range = { from: parseDate(values[0]), to: parseDate(values[1]) };
  const formatRange = ({ from, to }: DateRange) => {
    if (!from && !to) return "";
    return from && to ? "between" : "since";
  };
  return <p>{range.from || range.to ? formatRange(range) : "none"}</p>;
};
