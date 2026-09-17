import { AnalyticsScript } from "analytics-kit";

export default function AnalyticsPage() {
  return (
    <section>
      <AnalyticsScript domain="fixture.test" />
    </section>
  );
}
