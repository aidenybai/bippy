/**
 * A ternary kept in a variable runs on every render, even when it renders only behind
 * `&&`, so the states that render it don't show which side it takes.
 */

// next-shadcn-dashboard-starter src/components/ui/table/data-table-date-filter.tsx:128
export function DateRangeLabel({ from, to }: { from?: Date; to?: Date }) {
  const hasSelectedDates = from || to;
  const dateText = hasSelectedDates ? "range" : "Select date range";
  return <span>{hasSelectedDates && <b>{dateText}</b>}</span>;
}
