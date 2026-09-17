// date-fns validates dates with `isNaN(Number(date))`, builds them from
// `Date.UTC(...)` parts and reads a time zone's offset back through
// `Intl.DateTimeFormat`; date-fns-tz's `toDate` calls `isNaN(date)` on the Date.

const published = new Date("2022-04-04T01:00:00.000Z");
const invalid = new Date("not a date");

const isValid = (date: Date): boolean => !isNaN(Number(date));

const utcMidnight = new Date(
  Date.UTC(published.getUTCFullYear(), published.getUTCMonth(), published.getUTCDate()),
);
utcMidnight.setUTCFullYear(published.getUTCFullYear());

const newYork = new Intl.DateTimeFormat("en-US", {
  hour12: false,
  timeZone: "America/New_York",
  year: "numeric",
  month: "numeric",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const hourIn = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone }).format(date);

const Cell = ({ value }: { value: unknown }) => (
  <p>
    {String(value)}
    <br />
  </p>
);

export default function DateConversions() {
  return (
    <>
      <Cell value={isValid(published)} />
      <Cell value={isValid(invalid)} />
      <Cell value={isNaN(published)} />
      <Cell value={isFinite(invalid)} />
      <Cell value={Number(published) - utcMidnight.getTime()} />
      <Cell value={Date.parse("2022-04-04T01:00:00.000Z")} />
      <Cell value={String(published).length > 0 ? "text" : "empty"} />
      <Cell value={newYork.format(published)} />
      <Cell
        value={newYork
          .formatToParts(published)
          .map((part) => part.type)
          .join(",")}
      />
      <Cell value={hourIn(published, "Asia/Tokyo")} />
      <Cell value={newYork.resolvedOptions().timeZone} />
    </>
  );
}

export const isExact = true;
