import { createRoot } from "react-dom/client";
import { BrowserRouter, useRoutes } from "react-router";
import { rootRoutes } from "./routes.js";

const Router = () => useRoutes(rootRoutes);

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Router />
  </BrowserRouter>,
);
