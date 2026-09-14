import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Early } from "./early-routes";
import { Late } from "./late-routes";
import { setupSentry } from "./sentry";

setupSentry();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <main>
      <Early />
      <Late />
    </main>
  </BrowserRouter>,
);
