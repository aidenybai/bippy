import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const App = () => (
  <main>
    <h1>welcome</h1>
    <ul>
      {["rates", "trades"].map((tab) => (
        <li key={tab}>{tab}</li>
      ))}
    </ul>
  </main>
);

export const initApp = () => {
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};
