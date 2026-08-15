import "bippy/install-hook-only";

import { installConditionalHooks } from "./conditional-hooks";
import "./styles.css";

installConditionalHooks();

const { createRoot } = await import("react-dom/client");
const { StrictMode } = await import("react");
const { default: App } = await import("./app");

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element was not found.");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
