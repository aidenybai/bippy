import { createRoot } from "react-dom/client";

const label = JSON.stringify(process.env.LABEL);
const parts = `${process.env.LABEL}!`.split("!");

const App = () => (
  <output title={label}>
    {label}
    {parts.length}
  </output>
);

createRoot(document.getElementById("root") ?? document.body).render(<App />);
