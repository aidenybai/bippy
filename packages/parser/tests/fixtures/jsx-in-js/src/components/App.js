import { Widget } from "./Widget.js";

const stats = [
  { label: "Users", value: 12 },
  { label: "Orders", value: 4 },
];

export default function App({ title }) {
  const isWide = stats.length > 1;
  return (
    <main className={isWide ? "wide" : "narrow"}>
      <h1>{title}</h1>
      <ul>
        {stats.map((stat) => (
          <Widget key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </ul>
    </main>
  );
}
