import { createRoot } from "react-dom/client";
import { BrowserRouter, Route } from "react-router-dom";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Route path="/" />
  </BrowserRouter>,
);
