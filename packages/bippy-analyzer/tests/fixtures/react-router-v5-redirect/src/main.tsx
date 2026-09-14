import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading</p>}>
    <App />
  </Suspense>,
);
