import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    __bootDisabled?: boolean;
  }
}

const App = () => (
  <main>
    <h1>dashboard</h1>
    <p>ready</p>
  </main>
);

const mountApp = (): void => {
  const container = document.getElementById("root");
  if (!container || window.__bootDisabled) {
    console.error("not mounting");
    return;
  }
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

mountApp();
