import { createRoot } from "react-dom/client";
import english from "./locales/en.yaml";

const locales = import.meta.glob<{ default: Record<string, string> }>("./locales/*.yaml", {
  eager: true,
});

const LocaleList = () => (
  <ul>
    {Object.entries(locales).map(([file, module]) => (
      <li key={file}>
        {file}: {module.default.title} / {module.default.submit}
      </li>
    ))}
  </ul>
);

const App = () => (
  <main>
    <h1>{english.title}</h1>
    <LocaleList />
  </main>
);

createRoot(document.getElementById("root")!).render(<App />);
