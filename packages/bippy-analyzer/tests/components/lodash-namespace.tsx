import _ from "lodash-es";
import { useEffect, useState } from "react";

interface Row {
  id: number;
  label: string;
}

const ROWS: Row[] = [
  { id: 2, label: "beta" },
  { id: 1, label: "alpha" },
  { id: 2, label: "beta" },
];

/** `_.debounce` through the namespace is the rate limiter a named import gets: `leading: true` runs the setter synchronously. */
const LeadingEdge = () => {
  const [label, setLabel] = useState("idle");
  useEffect(() => {
    const announce = _.debounce((next: string) => setLabel(next), 50, { leading: true });
    announce("ready");
  }, []);
  return <em>{label}</em>;
};

export default function LodashNamespace() {
  const rows = _.sortBy(_.uniqBy(ROWS, "id"), "id");
  const labels = _.map(rows, "label");
  return (
    <section>
      <ul>
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <p>{_.capitalize(_.last(labels) ?? "")}</p>
      <p>{String(_.isEmpty(rows))}</p>
      <p>{String(_.isFunction(_.debounce))}</p>
      <LeadingEdge />
    </section>
  );
}

export const isExact = true;
