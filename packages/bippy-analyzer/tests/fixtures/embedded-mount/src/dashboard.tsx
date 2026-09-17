import type { EmbedProps } from "./embed";

export const Dashboard = ({ title, metrics = [] }: EmbedProps) => (
  <section>
    <h1>{title}</h1>
    {metrics.length === 0 ? <p>No metrics</p> : <p>{metrics.length} metrics</p>}
  </section>
);
