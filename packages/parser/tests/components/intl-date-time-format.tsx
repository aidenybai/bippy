import { useEffect, useState } from "react";

const RELEASE = new Date(Date.UTC(2024, 1, 29, 13, 5, 9));

const releaseDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "2-digit",
});

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const Clock = () => {
  const [currentTime, setCurrentTime] = useState("");
  useEffect(() => {
    const updateTime = () => setCurrentTime(clock.format(new Date()));
    updateTime();
    const intervalId = setInterval(updateTime, 1000);
    return () => clearInterval(intervalId);
  }, []);
  return <time>{currentTime}</time>;
};

export default function IntlDateTimeFormat() {
  const parts = releaseDay.formatToParts(RELEASE);
  return (
    <section>
      <p>{releaseDay.format(RELEASE)}</p>
      <p>{releaseDay.format(RELEASE.getTime())}</p>
      <p>{parts.find((part) => part.type === "month")?.value}</p>
      <p>{releaseDay.resolvedOptions().timeZone}</p>
      <p>
        {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(RELEASE)}
      </p>
      <Clock />
    </section>
  );
}
