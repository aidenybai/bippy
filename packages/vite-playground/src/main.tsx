import "bippy/install-hook-only";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import VitePlaygroundApp from "./vite-playground-app";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VitePlaygroundApp />
  </StrictMode>,
);
