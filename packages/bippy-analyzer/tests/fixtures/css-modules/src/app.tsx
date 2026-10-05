import theme from "./theme.module.css";
import { row } from "./theme.module.css";

const Accent = ({ color }: { color: string }) => <mark style={{ color }}>accent</mark>;

export const App = () => {
  const rows = Number(theme.compactRows);
  return (
    <section className={theme.card}>
      {theme.accentColor === "#2196f3" ? <Accent color={theme.accentColor} /> : null}
      <ul>
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className={row}>
            row {index}
          </li>
        ))}
      </ul>
      {typeof theme["row--active"] === "string" ? <footer>styled</footer> : <aside>unstyled</aside>}
    </section>
  );
};
